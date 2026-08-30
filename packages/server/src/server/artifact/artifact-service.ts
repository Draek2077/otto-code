import { randomBytes } from "node:crypto";
import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Logger } from "pino";
import type { z } from "zod";
import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentSessionConfig } from "../agent/agent-sdk-types.js";
import type { ProviderSnapshotManager } from "../agent/provider-snapshot-manager.js";
import type { ActivityIncrementFn } from "../activity-stats/activity-stats-store.js";
import { areEquivalentPaths } from "../../utils/path.js";
import type {
  ArtifactMetadata,
  ArtifactRunTrigger,
  ProjectArtifactStoreLocationValue,
  StoredArtifact,
} from "@otto-code/protocol/artifacts/types";
import type { ArtifactStore } from "./artifact-store.js";
import { ArtifactStoreRegistry } from "./artifact-store-registry.js";
import { ArtifactWatcher } from "./artifact-watcher.js";
import { ARTIFACT_SYSTEM_PROMPT } from "./artifact-prompt.js";
import { readArtifactData, replaceArtifactData } from "./artifact-data.js";
import type { CreateArtifactInput } from "@otto-code/protocol/artifacts/types";

export type { CreateArtifactInput };

export interface UpdateArtifactInput {
  artifactId: string;
  name?: string;
  description?: string;
  projectId?: string;
  provider?: string;
  model?: string;
  thinkingOptionId?: string;
}

type JsonData = z.infer<ReturnType<typeof z.json>>;

const GENERATION_CANCELLED_MESSAGE = "Generation cancelled";
const GENERATION_INTERRUPTED_ON_RESTART_MESSAGE = "Generation interrupted when Otto restarted";
const GENERATION_INTERRUPTED_WITH_BACKUP_RESTORED_MESSAGE =
  "Generation interrupted when Otto restarted; the previous ready output was restored";
const EXTERNAL_ARTIFACT_EDIT_ERROR_MESSAGE =
  "Artifact HTML was changed outside Otto and is not valid. Repair restores the last good output.";

// How long a generation may run before we give up, cancel the agent, and mark
// the artifact as timed out. Local models are slow, so the default is generous;
// override with OTTO_ARTIFACT_TIMEOUT_MS (milliseconds) to tune without a
// rebuild. Keep this as the single source of truth - the watcher's timer and
// the user-facing message both derive from it.
const DEFAULT_GENERATION_TIMEOUT_MS = 960_000;
const GENERATION_TIMEOUT_MS =
  parseInt(process.env.OTTO_ARTIFACT_TIMEOUT_MS ?? "", 10) || DEFAULT_GENERATION_TIMEOUT_MS;

function generationTimedOutMessage(): string {
  return `Generation timed out after ${Math.round(GENERATION_TIMEOUT_MS / 1000)} seconds`;
}

interface ArtifactServiceOptions {
  storeRegistry: ArtifactStoreRegistry;
  logger: Logger;
  agentManager: AgentManager;
  providerSnapshotManager: ProviderSnapshotManager;
  broadcastArtifactUpdate: (metadata: ArtifactMetadata) => void;
  onActivity?: ActivityIncrementFn;
}

class ArtifactNotFoundError extends Error {
  constructor(artifactId: string) {
    super(`Artifact "${artifactId}" not found`);
    this.name = "ArtifactNotFoundError";
  }
}

export class ArtifactService {
  private readonly storeRegistry: ArtifactStoreRegistry;
  private readonly watcher: ArtifactWatcher;
  private readonly logger: Logger;
  private readonly agentManager: AgentManager;
  private readonly providerSnapshotManager: ProviderSnapshotManager;
  private readonly broadcastArtifactUpdate: (metadata: ArtifactMetadata) => void;
  private readonly onActivity?: ActivityIncrementFn;
  // artifactId -> generation agentId, for the lifetime of an active run. Lets
  // cancel() interrupt the agent even before generationAgentId is persisted.
  private readonly runningGenerations = new Map<string, string>();
  // artifactId -> path of the prior HTML, set only while a *regeneration* is
  // in flight (never on a first-ever generation, which has nothing to back
  // up). Restored on failure/cancel/timeout so a failed regeneration doesn't
  // destroy an artifact's last successful output; discarded once the new
  // generation succeeds.
  private readonly regenerationBackups = new Map<
    string,
    { backupPath: string; htmlPath: string }
  >();

  constructor(options: ArtifactServiceOptions) {
    this.storeRegistry = options.storeRegistry;
    this.logger = options.logger.child({ module: "artifact-service" });
    this.agentManager = options.agentManager;
    this.providerSnapshotManager = options.providerSnapshotManager;
    this.broadcastArtifactUpdate = options.broadcastArtifactUpdate;
    this.onActivity = options.onActivity;
    this.watcher = new ArtifactWatcher({
      logger: this.logger,
      sendNotification: (metadata: ArtifactMetadata) => {
        this.broadcastArtifactUpdate(metadata);
      },
      timeoutMs: GENERATION_TIMEOUT_MS,
      // The watcher's timer fires here; the service owns the agent, so it does
      // the real teardown (cancel the run, mark timed out) rather than leaving
      // a hung/looping generation agent running in the background.
      onTimeout: (artifactId: string) => {
        void this.abortGeneration(artifactId, generationTimedOutMessage()).catch((error) => {
          this.logger.error({ err: error, artifactId }, "Failed to abort timed-out generation");
        });
      },
    });
  }

  async list(projectId?: string): Promise<ArtifactMetadata[]> {
    return this.storeRegistry.list(projectId);
  }

  /** Full record with generation run history, for inspect_artifact. */
  async inspect(artifactId: string): Promise<StoredArtifact> {
    const store = await this.storeForArtifact(artifactId);
    const record = await store.inspect(artifactId);
    if (!record) {
      throw new ArtifactNotFoundError(artifactId);
    }
    return record;
  }

  /** Open a new generation run in "running" state. */
  private async startRun(
    store: ArtifactStore,
    artifactId: string,
    trigger: ArtifactRunTrigger,
    provider: string | null,
    model: string | null,
    personalityName: string | null,
  ): Promise<void> {
    await store.appendRun(artifactId, {
      id: generateArtifactId(),
      trigger,
      status: "running",
      startedAt: new Date().toISOString(),
      endedAt: null,
      agentId: null,
      provider,
      model,
      personalityName,
      error: null,
    });
  }

  /** Close out the artifact's in-flight run. No-op if none is running, or if
   * the artifact was deleted while its generation was still winding down. */
  private async completeRun(
    artifactId: string,
    status: "succeeded" | "failed",
    error?: string,
  ): Promise<void> {
    const resolved = await this.storeRegistry.find(artifactId);
    if (!resolved) return;
    const store = resolved.store;
    await store.patchCurrentRun(artifactId, {
      status,
      endedAt: new Date().toISOString(),
      error: status === "failed" ? (error ?? null) : null,
    });
  }

  /** Land a spawn/run failure on the record and its run. Runs off the request
   * path, so it must never surface as an unhandled rejection: an artifact
   * deleted while its agent was still shutting down is simply gone. */
  private async recordGenerationFailure(
    store: ArtifactStore,
    artifactId: string,
    errorMessage: string,
  ): Promise<void> {
    try {
      if (!(await store.get(artifactId))) return;
      await store.update(artifactId, { status: "error", errorMessage });
      await this.completeRun(artifactId, "failed", errorMessage);
    } catch (error) {
      this.logger.warn({ err: error, artifactId }, "Failed to record artifact generation failure");
    }
  }

  /** Watcher success hook, shared by create and regenerate: mark the run
   * succeeded and drop any regeneration backup (a no-op for first generations). */
  private async handleGenerationReady(artifactId: string): Promise<void> {
    const store = await this.storeForArtifact(artifactId);
    const artifact = await store.get(artifactId);
    if (!artifact) return;
    await this.persistLastKnownGood(artifact.filePath);
    await store.update(artifactId, { repairAvailable: false, errorMessage: null });
    await this.completeRun(artifactId, "succeeded");
    await this.discardBackup(artifactId);
    this.watchReadyArtifact(artifactId, artifact.filePath, store);
  }

  async delete(artifactId: string): Promise<void> {
    this.watcher.unwatch(artifactId);
    await this.discardBackup(artifactId);
    const store = await this.storeForArtifact(artifactId);
    const artifact = await store.get(artifactId);
    await store.delete(artifactId);
    if (artifact) {
      await rm(this.lastKnownGoodPath(artifact.filePath), { force: true });
    }
    // Cascade: drop every retained generation transcript this artifact produced
    // so its chats don't outlive it.
    await this.agentManager.deleteRetainedTranscriptsForOwner({
      kind: "artifact",
      id: artifactId,
    });
  }

  stop(): void {
    this.watcher.stop();
  }

  /**
   * A live generation agent cannot survive a daemon restart. Reconcile its
   * persisted record once during bootstrap so the library never leaves an
   * Artifact indefinitely "generating". Regeneration keeps the old ready
   * document as `<html>.bak`; restore it before recording the failure, because
   * the in-memory backup map is necessarily empty in the new daemon process.
   */
  async reconcileInterruptedGenerations(): Promise<number> {
    const artifacts = await this.storeRegistry.list();
    let reconciled = 0;
    for (const artifact of artifacts) {
      if (artifact.status !== "generating") continue;
      const store = await this.storeForArtifact(artifact.id);
      const record = await store.inspect(artifact.id);
      if (!record || record.status !== "generating") continue;

      const restoredBackup = await this.restoreBackupAfterRestart(record.filePath, artifact.id);
      const errorMessage = restoredBackup
        ? GENERATION_INTERRUPTED_WITH_BACKUP_RESTORED_MESSAGE
        : GENERATION_INTERRUPTED_ON_RESTART_MESSAGE;
      await store.patchCurrentRun(artifact.id, {
        status: "failed",
        endedAt: new Date().toISOString(),
        error: errorMessage,
      });
      await store.update(artifact.id, {
        status: "error",
        generationAgentId: null,
        errorMessage,
      });
      const updated = await store.get(artifact.id);
      if (updated) this.broadcastArtifactUpdate(updated);
      reconciled += 1;
    }
    if (reconciled > 0) {
      this.logger.warn({ reconciled }, "Recovered interrupted artifact generations after restart");
    }
    return reconciled;
  }

  /** Start ready-state file monitoring after bootstrap. The daemon-global
   * service owns this pass so both host and repository stores are covered even
   * before a client session is connected. */
  async watchReadyArtifacts(): Promise<number> {
    const artifacts = await this.storeRegistry.list();
    let watched = 0;
    for (const artifact of artifacts) {
      if (artifact.status !== "ready") continue;
      const store = await this.storeForArtifact(artifact.id);
      this.watchReadyArtifact(artifact.id, artifact.filePath, store);
      watched += 1;
    }
    return watched;
  }

  async star(artifactId: string, starred: boolean): Promise<ArtifactMetadata> {
    const store = await this.storeForArtifact(artifactId);
    const existing = await store.get(artifactId);
    if (!existing) {
      throw new ArtifactNotFoundError(artifactId);
    }
    await store.update(artifactId, { starred });
    const updated = await store.get(artifactId);
    if (!updated) {
      throw new ArtifactNotFoundError(artifactId);
    }
    return updated;
  }

  async getContent(artifactId: string): Promise<string> {
    const store = await this.storeForArtifact(artifactId);
    const metadata = await store.get(artifactId);
    if (!metadata) {
      throw new ArtifactNotFoundError(artifactId);
    }
    if (metadata.repairAvailable) {
      throw new Error(`Artifact "${artifactId}" needs repair before it can be previewed`);
    }
    try {
      return await readFile(metadata.filePath, "utf-8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new Error(`Artifact HTML not found for "${artifactId}"`, { cause: error });
      }
      throw error;
    }
  }

  /** Read the explicitly mutable data contract without exposing presentation. */
  async getData(artifactId: string): Promise<JsonData | null> {
    // readArtifactData obtains this value exclusively through JSON.parse from
    // the explicit on-disk data contract.
    return (await readArtifactData(await this.getContent(artifactId))) as JsonData | null;
  }

  /**
   * Replace only the artifact's JSON data block. This deliberately does not
   * run an agent or touch the rest of the HTML, so the UI/style cannot drift.
   */
  async updateData(artifactId: string, data: unknown): Promise<ArtifactMetadata> {
    const store = await this.storeForArtifact(artifactId);
    const metadata = await store.get(artifactId);
    if (!metadata) {
      throw new ArtifactNotFoundError(artifactId);
    }
    const path = metadata.filePath;
    const updatedHtml = replaceArtifactData(await this.getContent(artifactId), data);
    // Stop the ready watcher before renaming over the file so our own write
    // is not mistaken for an external edit; it is re-armed once the record
    // and last-known-good snapshot reflect the new content.
    this.watcher.unwatch(artifactId);
    const temporaryPath = `${path}.data-update-${randomBytes(4).toString("hex")}`;
    await writeFile(temporaryPath, updatedHtml, "utf-8");
    await rename(temporaryPath, path);
    await this.persistLastKnownGood(path);
    await store.update(artifactId, {
      status: "ready",
      errorMessage: null,
      repairAvailable: false,
    });
    const updated = await store.get(artifactId);
    if (!updated) {
      throw new ArtifactNotFoundError(artifactId);
    }
    this.broadcastArtifactUpdate(updated);
    this.watchReadyArtifact(artifactId, updated.filePath, store);
    return updated;
  }

  /** Explicitly overwrite an invalid externally-edited artifact with its
   * durable last-known-good HTML. The invalid file remains untouched until the
   * user invokes this method. */
  async repair(artifactId: string): Promise<ArtifactMetadata> {
    const store = await this.storeForArtifact(artifactId);
    const artifact = await store.get(artifactId);
    if (!artifact) throw new ArtifactNotFoundError(artifactId);
    if (!artifact.repairAvailable) {
      throw new Error(`Artifact "${artifactId}" does not have a repairable last good output`);
    }

    const snapshotPath = this.lastKnownGoodPath(artifact.filePath);
    try {
      await access(snapshotPath);
    } catch (error) {
      if (isEnoent(error)) {
        throw new Error(`Artifact "${artifactId}" has no last good output to restore`, {
          cause: error,
        });
      }
      throw error;
    }
    const temporaryPath = `${artifact.filePath}.repair-${randomBytes(4).toString("hex")}`;
    await copyFile(snapshotPath, temporaryPath);
    await rename(temporaryPath, artifact.filePath);
    await store.update(artifactId, {
      status: "ready",
      errorMessage: null,
      repairAvailable: false,
    });
    const repaired = await store.get(artifactId);
    if (!repaired) throw new ArtifactNotFoundError(artifactId);
    this.watchReadyArtifact(artifactId, repaired.filePath, store);
    this.broadcastArtifactUpdate(repaired);
    return repaired;
  }

  /**
   * Explicitly move one settled artifact between the project's repository and
   * host stores. The selected preference controls only future writes; this is
   * the separate, user-requested ownership transfer. Destination files are
   * staged first, source files are hidden as rollback backups, then the
   * destination is promoted. A failed promotion restores the source before it
   * becomes visible again.
   */
  async move(
    artifactId: string,
    destination: ProjectArtifactStoreLocationValue,
  ): Promise<ArtifactMetadata> {
    const sourceStore = await this.storeForArtifact(artifactId);
    const stored = await sourceStore.inspect(artifactId);
    if (!stored) throw new ArtifactNotFoundError(artifactId);
    if (stored.status === "generating" || this.runningGenerations.has(artifactId)) {
      throw new Error("Cancel or wait for artifact generation before moving it");
    }
    const resolvedDestination = await this.storeRegistry.resolveForProjectAtLocation(
      stored.projectId,
      destination,
    );
    // Compare directories, not labels: a pre-0.9 record in <root>/.otto/artifacts
    // carries no storageLocation yet is already in the repository store, and
    // the legacy host bucket is a different directory from the project's
    // host store even though both are "host".
    if (
      areEquivalentPaths(resolvedDestination.location.artifactsDirectory, dirname(stored.filePath))
    ) {
      throw new Error(`Artifact "${artifactId}" is already stored in ${destination}`);
    }
    if (await resolvedDestination.store.get(artifactId)) {
      throw new Error(`Artifact "${artifactId}" already exists in the ${destination} store`);
    }

    this.watcher.unwatch(artifactId);
    const destinationHtmlPath = resolvedDestination.store.htmlPath(artifactId);
    const updated: StoredArtifact = {
      ...stored,
      filePath: destinationHtmlPath,
      storageLocation: destination,
      updatedAt: new Date().toISOString(),
    };
    const token = randomBytes(4).toString("hex");
    const files: Array<{ source: string; destination: string; contents?: string }> = [
      {
        source: sourceStore.recordPath(artifactId),
        destination: resolvedDestination.store.recordPath(artifactId),
        contents: JSON.stringify(updated, null, 2),
      },
      { source: stored.filePath, destination: destinationHtmlPath },
      {
        source: this.lastKnownGoodPath(stored.filePath),
        destination: this.lastKnownGoodPath(destinationHtmlPath),
      },
    ];
    const existingFiles = [] as Array<{ source: string; destination: string; contents?: string }>;
    for (const file of files) {
      if (file.contents !== undefined || (await fileExists(file.source))) {
        existingFiles.push(file);
      }
    }
    const stagedDestination = existingFiles.map(
      ({ source, destination: destinationPath, contents }) => ({
        source,
        destination: destinationPath,
        contents,
        temporary: `${destinationPath}.move-${token}`,
        backup: `${source}.move-backup-${token}`,
      }),
    );

    try {
      await mkdir(dirname(resolvedDestination.store.recordPath(artifactId)), { recursive: true });
      for (const file of stagedDestination) {
        if (file.contents !== undefined) {
          await writeFile(file.temporary, file.contents, "utf-8");
        } else {
          await copyFile(file.source, file.temporary);
        }
      }

      const hiddenSources: typeof stagedDestination = [];
      try {
        for (const file of stagedDestination) {
          await rename(file.source, file.backup);
          hiddenSources.push(file);
        }
      } catch (error) {
        await restoreMoveSources(hiddenSources);
        throw error;
      }

      const promotedDestinations: typeof stagedDestination = [];
      try {
        for (const file of stagedDestination) {
          await rename(file.temporary, file.destination);
          promotedDestinations.push(file);
        }
      } catch (error) {
        await Promise.all(
          promotedDestinations.map((file) => rm(file.destination, { force: true }).catch(() => {})),
        );
        await restoreMoveSources(hiddenSources);
        throw error;
      }

      // The ownership transfer has succeeded once every destination file is
      // promoted. A leftover backup is recoverable housekeeping, not a reason
      // to report a failed move after the source is gone.
      await Promise.all(
        hiddenSources.map(async (file) => {
          try {
            await rm(file.backup, { force: true });
          } catch (error) {
            this.logger.warn(
              { error, artifactId, backupPath: file.backup },
              "Artifact move left a source backup for later cleanup",
            );
          }
        }),
      );
    } catch (error) {
      await Promise.all(
        stagedDestination.map((file) => rm(file.temporary, { force: true }).catch(() => {})),
      );
      if (stored.status === "ready")
        this.watchReadyArtifact(artifactId, stored.filePath, sourceStore);
      throw error;
    }

    const metadata = await resolvedDestination.store.get(artifactId);
    if (!metadata) throw new ArtifactNotFoundError(artifactId);
    if (metadata.status === "ready") {
      this.watchReadyArtifact(artifactId, metadata.filePath, resolvedDestination.store);
    }
    this.broadcastArtifactUpdate(metadata);
    return metadata;
  }

  async create(input: CreateArtifactInput): Promise<ArtifactMetadata> {
    const artifactId = generateArtifactId();
    const now = new Date().toISOString();
    const resolvedStore = await this.storeRegistry.resolveForProject(input.projectId);
    const { store, location } = resolvedStore;
    const filePath = store.htmlPath(artifactId);
    const metadata: ArtifactMetadata = {
      id: artifactId,
      name: input.name,
      description: input.description,
      projectId: location.projectRoot,
      filePath,
      kind: "html",
      status: "generating",
      starred: false,
      createdAt: now,
      updatedAt: now,
      generationAgentId: null,
      generationProvider: input.provider,
      generationModel: input.model ?? null,
      generationModeId: input.modeId ?? null,
      generationThinkingOptionId: input.thinkingOptionId ?? null,
      generationSpinner: input.spinner ?? null,
      generationPersonalityName: input.personalityName ?? null,
      ...(input.source ? { source: input.source } : {}),
      storageLocation: location.location,
      repairAvailable: false,
      errorMessage: null,
    };

    await store.create(metadata);
    this.onActivity?.("artifactsCreated");
    await this.startRun(
      store,
      artifactId,
      "create",
      metadata.generationProvider,
      metadata.generationModel,
      metadata.generationPersonalityName ?? null,
    );
    this.watcher.watch(artifactId, filePath, store, () => this.handleGenerationReady(artifactId));
    void this.spawnArtifactAgent(artifactId, metadata, input).catch((error) => {
      this.logger.error({ err: error, artifactId }, "Failed to spawn artifact agent");
      void this.recordGenerationFailure(store, artifactId, String(error));
    });

    return metadata;
  }

  /**
   * Edit an artifact's metadata WITHOUT regenerating. Only provided fields are
   * overwritten. Editing never re-runs the agent - the user regenerates
   * separately once they're happy with the changes.
   */
  async update(input: UpdateArtifactInput): Promise<ArtifactMetadata> {
    const store = await this.storeForArtifact(input.artifactId);
    const existing = await store.get(input.artifactId);
    if (!existing) {
      throw new ArtifactNotFoundError(input.artifactId);
    }
    // The edit sheet always sends the project it resolved for the artifact,
    // which may spell the same root differently from the stored value (drive
    // letter case, separators, a worktree cwd recorded before canonical
    // roots). Compare as paths so a plain rename is never mistaken for a move.
    if (input.projectId !== undefined && !areEquivalentPaths(input.projectId, existing.projectId)) {
      throw new Error("Artifacts cannot be moved between projects. Create a new artifact instead.");
    }
    await store.update(input.artifactId, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.provider !== undefined ? { generationProvider: input.provider } : {}),
      ...(input.model !== undefined ? { generationModel: input.model || null } : {}),
      ...(input.thinkingOptionId !== undefined
        ? { generationThinkingOptionId: input.thinkingOptionId || null }
        : {}),
    });
    const updated = await store.get(input.artifactId);
    if (!updated) {
      throw new ArtifactNotFoundError(input.artifactId);
    }
    return updated;
  }

  /**
   * Re-run generation for an existing artifact using its stored config. Resets
   * the artifact to "generating", clears the prior error, and spawns a fresh
   * agent.
   */
  async regenerate(artifactId: string): Promise<ArtifactMetadata> {
    const store = await this.storeForArtifact(artifactId);
    const existing = await store.get(artifactId);
    if (!existing) {
      throw new ArtifactNotFoundError(artifactId);
    }

    const provider = existing.generationProvider ?? "";
    if (!provider) {
      throw new Error(`Artifact "${artifactId}" has no provider to regenerate with`);
    }
    const model = existing.generationModel ?? undefined;

    await store.update(artifactId, {
      status: "generating",
      errorMessage: null,
      generationAgentId: null,
    });
    const updated = await store.get(artifactId);
    if (!updated) {
      throw new ArtifactNotFoundError(artifactId);
    }

    // Move the prior HTML out of the way before watching, rather than
    // deleting it: the watcher marks an artifact "ready" the instant it sees
    // a valid file at filePath, so leaving the old output in place would flip
    // status straight back to "ready" with stale content and stop watching
    // before the new agent writes anything. Keeping it as a backup lets a
    // failed regeneration restore the last successful version instead of
    // losing it outright.
    await this.startRun(
      store,
      artifactId,
      "regenerate",
      provider,
      model ?? null,
      existing.generationPersonalityName ?? null,
    );
    // A ready artifact is under a ready-mode watch. Drop it first: watch()
    // is a no-op while any handle exists, and the ready watcher would treat
    // the backup rename below as an external edit and flip the record to
    // "error" while the agent is still generating.
    this.watcher.unwatch(artifactId);
    await this.backupBeforeRegenerate(artifactId, updated.filePath);
    this.watcher.watch(artifactId, updated.filePath, store, () =>
      this.handleGenerationReady(artifactId),
    );
    void this.spawnArtifactAgent(artifactId, updated, {
      name: updated.name,
      description: updated.description,
      projectId: updated.projectId,
      provider,
      model,
      // Re-run with the originally requested mode/effort. The mode is safe to
      // replay as-is: spawnArtifactAgent only honors it if unattended.
      modeId: updated.generationModeId ?? undefined,
      thinkingOptionId: updated.generationThinkingOptionId ?? undefined,
    }).catch(async (error) => {
      this.logger.error({ err: error, artifactId }, "Failed to regenerate artifact");
      await this.restoreBackup(artifactId);
      void this.recordGenerationFailure(store, artifactId, String(error));
    });

    return updated;
  }

  /**
   * Cancel an in-progress generation and recover the artifact. Stops the agent
   * run, stops the watcher (so a partial/late file can't flip status back to
   * "ready"), and lands the artifact in an error state so it can be regenerated
   * or deleted.
   */
  async cancel(artifactId: string): Promise<ArtifactMetadata> {
    const existing = await (await this.storeForArtifact(artifactId)).get(artifactId);
    if (!existing) {
      throw new ArtifactNotFoundError(artifactId);
    }

    const updated = await this.abortGeneration(artifactId, GENERATION_CANCELLED_MESSAGE);
    if (!updated) {
      throw new ArtifactNotFoundError(artifactId);
    }
    return updated;
  }

  /**
   * Shared teardown for a generation that must stop early - user cancel or
   * timeout. Stops the watcher (so a partial/late file can't flip status back
   * to "ready"), cancels the generation agent so nothing lingers, and lands the
   * artifact in an error state so it can be regenerated or deleted. Safe to call
   * when the agent has already finished: cancelAgentRun on a closed agent is
   * caught and logged. Returns the updated metadata, or null if the artifact
   * disappeared underneath us.
   */
  private async abortGeneration(
    artifactId: string,
    errorMessage: string,
  ): Promise<ArtifactMetadata | null> {
    // Stop watching first so an in-flight checkFileReady can't race us to
    // "ready" after we mark the artifact as errored.
    this.watcher.unwatch(artifactId);

    const store = await this.storeForArtifact(artifactId);
    const existing = await store.get(artifactId);
    const agentId = this.runningGenerations.get(artifactId) ?? existing?.generationAgentId;
    if (agentId) {
      try {
        await this.agentManager.cancelAgentRun(agentId);
      } catch (error) {
        this.logger.warn({ err: error, artifactId, agentId }, "Failed to cancel generation agent");
      }
    }

    // If this aborted a regeneration (not a first-ever generation), restore
    // the prior successful output rather than leaving the artifact with none.
    await this.restoreBackup(artifactId);

    await store.update(artifactId, {
      status: "error",
      errorMessage,
      generationAgentId: null,
      // Whatever is on disk now is either the restored last-ready output or
      // nothing at all; neither is a corrupted file that Repair should offer
      // to overwrite, even if a ready watcher flagged the backup rename.
      repairAvailable: false,
    });
    await this.completeRun(artifactId, "failed", errorMessage);
    return store.get(artifactId);
  }

  /** Move the current HTML aside so a regeneration can't be mistaken for
   * "ready" by the watcher. No-ops (leaves nothing to restore) when there's
   * no prior file - a first-ever generation has none. */
  private async backupBeforeRegenerate(artifactId: string, filePath: string): Promise<void> {
    const backupPath = `${filePath}.bak`;
    try {
      await rename(filePath, backupPath);
      this.regenerationBackups.set(artifactId, { backupPath, htmlPath: filePath });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }

  /** Restore the last ready output left by a regeneration interrupted at restart. */
  private async restoreBackupAfterRestart(filePath: string, artifactId: string): Promise<boolean> {
    const backupPath = `${filePath}.bak`;
    try {
      await access(backupPath);
    } catch (error) {
      if (isEnoent(error)) return false;
      this.logger.warn({ err: error, artifactId, backupPath }, "Failed to inspect artifact backup");
      return false;
    }

    const interruptedPath = `${filePath}.interrupted-${randomBytes(4).toString("hex")}`;
    let movedInterruptedOutput = false;
    try {
      try {
        await rename(filePath, interruptedPath);
        movedInterruptedOutput = true;
      } catch (error) {
        if (!isEnoent(error)) throw error;
      }
      await rename(backupPath, filePath);
      if (movedInterruptedOutput) await rm(interruptedPath, { force: true });
      return true;
    } catch (error) {
      if (movedInterruptedOutput) {
        await rename(interruptedPath, filePath).catch(() => undefined);
      }
      this.logger.error(
        { err: error, artifactId, backupPath },
        "Failed to restore artifact backup after restart",
      );
      return false;
    }
  }

  /** Restore a regeneration's backup after a failed/cancelled/timed-out
   * attempt. No-op if there's no backup (first-ever generation, or already
   * consumed). */
  private async restoreBackup(artifactId: string): Promise<void> {
    const backup = this.regenerationBackups.get(artifactId);
    if (!backup) {
      return;
    }
    this.regenerationBackups.delete(artifactId);
    try {
      await rename(backup.backupPath, backup.htmlPath);
    } catch (error) {
      this.logger.warn(
        { err: error, artifactId },
        "Failed to restore artifact backup after failed regeneration",
      );
    }
  }

  /** Drop a regeneration's backup once the new generation has succeeded. */
  private async discardBackup(artifactId: string): Promise<void> {
    const backup = this.regenerationBackups.get(artifactId);
    if (!backup) {
      return;
    }
    this.regenerationBackups.delete(artifactId);
    try {
      await rm(backup.backupPath, { force: true });
    } catch (error) {
      this.logger.warn({ err: error, artifactId }, "Failed to remove stale artifact backup");
    }
  }

  private watchReadyArtifact(artifactId: string, filePath: string, store: ArtifactStore): void {
    this.watcher.watchReady(
      artifactId,
      filePath,
      store,
      async (content) => {
        const artifact = await store.get(artifactId);
        if (!artifact) return;
        // The daemon owns one ArtifactService and may itself take this record
        // out of "ready" while regenerating or moving it. In that case its
        // watcher must stand down instead of reclassifying the daemon-owned
        // rename as an external edit.
        if (artifact.status !== "ready" || artifact.filePath !== filePath) return;
        if (content === null) {
          const repairAvailable = await this.hasLastKnownGood(filePath);
          await store.update(artifactId, {
            status: "error",
            errorMessage: EXTERNAL_ARTIFACT_EDIT_ERROR_MESSAGE,
            repairAvailable,
          });
        } else {
          await this.persistLastKnownGood(filePath, content);
          await store.update(artifactId, {
            status: "ready",
            errorMessage: null,
            repairAvailable: false,
          });
        }
        const updated = await store.get(artifactId);
        if (updated) this.broadcastArtifactUpdate(updated);
        if (content !== null) this.watchReadyArtifact(artifactId, filePath, store);
      },
      this.broadcastArtifactUpdate,
    );
  }

  private lastKnownGoodPath(filePath: string): string {
    return `${filePath}.last-good`;
  }

  private async hasLastKnownGood(filePath: string): Promise<boolean> {
    try {
      await access(this.lastKnownGoodPath(filePath));
      return true;
    } catch (error) {
      if (isEnoent(error)) return false;
      throw error;
    }
  }

  private async persistLastKnownGood(filePath: string, content?: string): Promise<void> {
    const snapshotPath = this.lastKnownGoodPath(filePath);
    const temporaryPath = `${snapshotPath}.tmp-${randomBytes(4).toString("hex")}`;
    await writeFile(temporaryPath, content ?? (await readFile(filePath, "utf-8")), "utf-8");
    await rename(temporaryPath, snapshotPath);
  }

  private async spawnArtifactAgent(
    artifactId: string,
    metadata: ArtifactMetadata,
    input: CreateArtifactInput,
  ): Promise<void> {
    const htmlPath = metadata.filePath;

    const agentPrompt = `${metadata.description}\n\nWrite the HTML file to: ${htmlPath}`;

    // Artifacts run unattended: no client is watching to approve tool calls, so
    // resolve the provider's unattended mode (unless the user picked an explicit
    // mode that is itself unattended) exactly like the schedule runner does, or
    // the agent stalls on the first approval prompt and the artifact never
    // leaves "generating". A non-unattended modeId can leak in from the create
    // sheet inheriting the user's last-used chat mode preference, so it's only
    // honored when it actually won't prompt.
    const requestedModeIsUnattended =
      input.modeId !== undefined &&
      (
        await this.providerSnapshotManager.listModes({
          provider: input.provider,
          cwd: metadata.projectId,
          wait: true,
        })
      ).some((mode) => mode.id === input.modeId && mode.isUnattended === true);
    const resolved: {
      modeId: string | undefined;
      featureValues: Record<string, unknown> | undefined;
    } = requestedModeIsUnattended
      ? { modeId: input.modeId, featureValues: undefined }
      : await this.providerSnapshotManager.resolveCreateConfig({
          provider: input.provider,
          cwd: metadata.projectId,
          requestedMode: undefined,
          featureValues: undefined,
          parent: null,
          unattended: true,
          // Let the provider pick a model-aware unattended target (Claude
          // resolves dontAsk, upgraded to auto when the model supports it).
          model: input.model,
        });

    const config: AgentSessionConfig = {
      provider: input.provider,
      model: input.model,
      modeId: resolved.modeId,
      thinkingOptionId: input.thinkingOptionId,
      featureValues: resolved.featureValues,
      systemPrompt: ARTIFACT_SYSTEM_PROMPT,
      cwd: metadata.projectId,
      internal: true,
      // The generator always runs unattended (nobody need be watching), so arm
      // the deny-responder to auto-deny any permission escalation the coerced
      // mode surfaces (e.g. Auto's classifier). See safe-unattended.md.
      unattended: true,
      // Keep the agent out of listings/sidebar (internal) but let a client that
      // opens the generation log watch its stream live (observable). Without
      // this, the daemon's global subscription drops the agent's stream events
      // and the log only updates on manual re-fetch (navigate away and back).
      observable: true,
      title: metadata.name,
    };

    const agent = await this.agentManager.createAgent(config, undefined, {
      initialPrompt: agentPrompt,
      initialTitle: metadata.name,
      // Explicitly no workspace: the generator is an ephemeral internal agent
      // that must never appear in the sidebar.
      workspaceId: undefined,
    });
    // Register before running so cancel() can interrupt this run immediately.
    this.runningGenerations.set(artifactId, agent.id);
    const store = await this.storeForArtifact(artifactId);
    await store.update(artifactId, { generationAgentId: agent.id });
    await store.patchCurrentRun(artifactId, { agentId: agent.id });

    // Creating the agent only spins up the session; the prompt must be run to
    // actually generate the file. The watcher flips the artifact to "ready"
    // when the HTML lands. Close (not archive) the ephemeral internal agent
    // afterward - internal agents are never persisted, matching how other
    // one-shot internal agents (branch-name/git-metadata generators) tear down.
    try {
      await this.agentManager.runAgent(agent.id, agentPrompt);
    } finally {
      this.runningGenerations.delete(artifactId);
      // Snapshot the generation chat before tearing the internal agent down, so
      // it can be reopened read-only from the artifact's "…" menu. Internal
      // agents are never persisted, so without this the transcript is lost on
      // close. See docs/safe-unattended.md.
      await this.agentManager.captureRetainedTranscript(
        agent.id,
        { kind: "artifact", id: artifactId },
        { title: metadata.name },
      );
      try {
        await this.agentManager.closeAgent(agent.id);
      } catch {
        // Ignore cleanup errors; the run result is what matters.
      }
    }
  }

  private async storeForArtifact(artifactId: string): Promise<ArtifactStore> {
    const resolved = await this.storeRegistry.find(artifactId);
    if (!resolved) {
      throw new ArtifactNotFoundError(artifactId);
    }
    return resolved.store;
  }
}

function generateArtifactId(): string {
  return randomBytes(4).toString("hex");
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isEnoent(error)) return false;
    throw error;
  }
}

async function restoreMoveSources(files: Array<{ source: string; backup: string }>): Promise<void> {
  for (const file of files.toReversed()) {
    await rename(file.backup, file.source).catch(() => undefined);
  }
}
