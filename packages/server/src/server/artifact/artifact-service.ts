import { randomBytes } from "node:crypto";
import { readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "pino";
import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentSessionConfig } from "../agent/agent-sdk-types.js";
import type { ProviderSnapshotManager } from "../agent/provider-snapshot-manager.js";
import type { ActivityIncrementFn } from "../activity-stats/activity-stats-store.js";
import type {
  ArtifactMetadata,
  ArtifactRunTrigger,
  StoredArtifact,
} from "@otto-code/protocol/artifacts/types";
import { ArtifactStore, assertValidArtifactId } from "./artifact-store.js";
import { ArtifactWatcher } from "./artifact-watcher.js";
import { ARTIFACT_SYSTEM_PROMPT } from "./artifact-prompt.js";
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

const GENERATION_CANCELLED_MESSAGE = "Generation cancelled";

// How long a generation may run before we give up, cancel the agent, and mark
// the artifact as timed out. Local models are slow, so the default is generous;
// override with OTTO_ARTIFACT_TIMEOUT_MS (milliseconds) to tune without a
// rebuild. Keep this as the single source of truth — the watcher's timer and
// the user-facing message both derive from it.
const DEFAULT_GENERATION_TIMEOUT_MS = 960_000;
const GENERATION_TIMEOUT_MS =
  parseInt(process.env.OTTO_ARTIFACT_TIMEOUT_MS ?? "", 10) || DEFAULT_GENERATION_TIMEOUT_MS;

function generationTimedOutMessage(): string {
  return `Generation timed out after ${Math.round(GENERATION_TIMEOUT_MS / 1000)} seconds`;
}

interface ArtifactServiceOptions {
  projectCwd: string;
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
  private readonly store: ArtifactStore;
  private readonly watcher: ArtifactWatcher;
  private readonly projectCwd: string;
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
  private readonly regenerationBackups = new Map<string, string>();

  constructor(options: ArtifactServiceOptions) {
    this.projectCwd = options.projectCwd;
    this.store = new ArtifactStore(options.projectCwd);
    this.logger = options.logger.child({ module: "artifact-service" });
    this.agentManager = options.agentManager;
    this.providerSnapshotManager = options.providerSnapshotManager;
    this.broadcastArtifactUpdate = options.broadcastArtifactUpdate;
    this.onActivity = options.onActivity;
    this.watcher = new ArtifactWatcher({
      store: this.store,
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
    return this.store.list(projectId ? { projectId } : undefined);
  }

  /** Full record with generation run history, for inspect_artifact. */
  async inspect(artifactId: string): Promise<StoredArtifact> {
    const record = await this.store.inspect(artifactId);
    if (!record) {
      throw new ArtifactNotFoundError(artifactId);
    }
    return record;
  }

  /** Open a new generation run in "running" state. */
  private async startRun(
    artifactId: string,
    trigger: ArtifactRunTrigger,
    provider: string | null,
    model: string | null,
    personalityName: string | null,
  ): Promise<void> {
    await this.store.appendRun(artifactId, {
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

  /** Close out the artifact's in-flight run. No-op if none is running. */
  private async completeRun(
    artifactId: string,
    status: "succeeded" | "failed",
    error?: string,
  ): Promise<void> {
    await this.store.patchCurrentRun(artifactId, {
      status,
      endedAt: new Date().toISOString(),
      error: status === "failed" ? (error ?? null) : null,
    });
  }

  /** Watcher success hook, shared by create and regenerate: mark the run
   * succeeded and drop any regeneration backup (a no-op for first generations). */
  private handleGenerationReady(artifactId: string): void {
    void this.completeRun(artifactId, "succeeded");
    void this.discardBackup(artifactId);
  }

  async delete(artifactId: string): Promise<void> {
    this.watcher.unwatch(artifactId);
    await this.discardBackup(artifactId);
    await this.store.delete(artifactId);
  }

  stop(): void {
    this.watcher.stop();
  }

  async star(artifactId: string, starred: boolean): Promise<ArtifactMetadata> {
    const existing = await this.store.get(artifactId);
    if (!existing) {
      throw new ArtifactNotFoundError(artifactId);
    }
    await this.store.update(artifactId, { starred });
    const updated = await this.store.get(artifactId);
    if (!updated) {
      throw new ArtifactNotFoundError(artifactId);
    }
    return updated;
  }

  async getContent(artifactId: string): Promise<string> {
    const metadata = await this.store.get(artifactId);
    if (!metadata) {
      throw new ArtifactNotFoundError(artifactId);
    }
    try {
      return await readFile(this.resolveHtmlPath(artifactId), "utf-8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new Error(`Artifact HTML not found for "${artifactId}"`, { cause: error });
      }
      throw error;
    }
  }

  async create(input: CreateArtifactInput): Promise<ArtifactMetadata> {
    const artifactId = generateArtifactId();
    const now = new Date().toISOString();
    const filePath = this.resolveHtmlPath(artifactId);
    const metadata: ArtifactMetadata = {
      id: artifactId,
      name: input.name,
      description: input.description,
      projectId: input.projectId ?? "",
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
      errorMessage: null,
    };

    await this.store.create(metadata);
    this.onActivity?.("artifactsCreated");
    await this.startRun(
      artifactId,
      "create",
      metadata.generationProvider,
      metadata.generationModel,
      metadata.generationPersonalityName ?? null,
    );
    this.watcher.watch(artifactId, filePath, () => this.handleGenerationReady(artifactId));
    void this.spawnArtifactAgent(artifactId, metadata, input).catch((error) => {
      this.logger.error({ err: error, artifactId }, "Failed to spawn artifact agent");
      void this.store.update(artifactId, { status: "error", errorMessage: String(error) });
      void this.completeRun(artifactId, "failed", String(error));
    });

    return metadata;
  }

  /**
   * Edit an artifact's metadata WITHOUT regenerating. Only provided fields are
   * overwritten. Editing never re-runs the agent — the user regenerates
   * separately once they're happy with the changes.
   */
  async update(input: UpdateArtifactInput): Promise<ArtifactMetadata> {
    const existing = await this.store.get(input.artifactId);
    if (!existing) {
      throw new ArtifactNotFoundError(input.artifactId);
    }
    await this.store.update(input.artifactId, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input.provider !== undefined ? { generationProvider: input.provider } : {}),
      ...(input.model !== undefined ? { generationModel: input.model || null } : {}),
      ...(input.thinkingOptionId !== undefined
        ? { generationThinkingOptionId: input.thinkingOptionId || null }
        : {}),
    });
    const updated = await this.store.get(input.artifactId);
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
    const existing = await this.store.get(artifactId);
    if (!existing) {
      throw new ArtifactNotFoundError(artifactId);
    }

    const provider = existing.generationProvider ?? "";
    if (!provider) {
      throw new Error(`Artifact "${artifactId}" has no provider to regenerate with`);
    }
    const model = existing.generationModel ?? undefined;

    await this.store.update(artifactId, {
      status: "generating",
      errorMessage: null,
      generationAgentId: null,
    });
    const updated = await this.store.get(artifactId);
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
      artifactId,
      "regenerate",
      provider,
      model ?? null,
      existing.generationPersonalityName ?? null,
    );
    await this.backupBeforeRegenerate(artifactId, updated.filePath);
    this.watcher.watch(artifactId, updated.filePath, () => this.handleGenerationReady(artifactId));
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
      void this.store.update(artifactId, { status: "error", errorMessage: String(error) });
      void this.completeRun(artifactId, "failed", String(error));
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
    const existing = await this.store.get(artifactId);
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
   * Shared teardown for a generation that must stop early — user cancel or
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

    const existing = await this.store.get(artifactId);
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

    await this.store.update(artifactId, {
      status: "error",
      errorMessage,
      generationAgentId: null,
    });
    await this.completeRun(artifactId, "failed", errorMessage);
    return this.store.get(artifactId);
  }

  /** Move the current HTML aside so a regeneration can't be mistaken for
   * "ready" by the watcher. No-ops (leaves nothing to restore) when there's
   * no prior file — a first-ever generation has none. */
  private async backupBeforeRegenerate(artifactId: string, filePath: string): Promise<void> {
    const backupPath = `${filePath}.bak`;
    try {
      await rename(filePath, backupPath);
      this.regenerationBackups.set(artifactId, backupPath);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }

  /** Restore a regeneration's backup after a failed/cancelled/timed-out
   * attempt. No-op if there's no backup (first-ever generation, or already
   * consumed). */
  private async restoreBackup(artifactId: string): Promise<void> {
    const backupPath = this.regenerationBackups.get(artifactId);
    if (!backupPath) {
      return;
    }
    this.regenerationBackups.delete(artifactId);
    try {
      await rename(backupPath, this.resolveHtmlPath(artifactId));
    } catch (error) {
      this.logger.warn(
        { err: error, artifactId },
        "Failed to restore artifact backup after failed regeneration",
      );
    }
  }

  /** Drop a regeneration's backup once the new generation has succeeded. */
  private async discardBackup(artifactId: string): Promise<void> {
    const backupPath = this.regenerationBackups.get(artifactId);
    if (!backupPath) {
      return;
    }
    this.regenerationBackups.delete(artifactId);
    try {
      await rm(backupPath, { force: true });
    } catch (error) {
      this.logger.warn({ err: error, artifactId }, "Failed to remove stale artifact backup");
    }
  }

  private async spawnArtifactAgent(
    artifactId: string,
    metadata: ArtifactMetadata,
    input: CreateArtifactInput,
  ): Promise<void> {
    const htmlPath = this.resolveHtmlPath(artifactId);

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
          cwd: this.projectCwd,
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
          cwd: this.projectCwd,
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
      cwd: this.projectCwd,
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
    await this.store.update(artifactId, { generationAgentId: agent.id });
    await this.store.patchCurrentRun(artifactId, { agentId: agent.id });

    // Creating the agent only spins up the session; the prompt must be run to
    // actually generate the file. The watcher flips the artifact to "ready"
    // when the HTML lands. Close (not archive) the ephemeral internal agent
    // afterward — internal agents are never persisted, matching how other
    // one-shot internal agents (branch-name/git-metadata generators) tear down.
    try {
      await this.agentManager.runAgent(agent.id, agentPrompt);
    } finally {
      this.runningGenerations.delete(artifactId);
      try {
        await this.agentManager.closeAgent(agent.id);
      } catch {
        // Ignore cleanup errors; the run result is what matters.
      }
    }
  }

  private resolveHtmlPath(artifactId: string): string {
    assertValidArtifactId(artifactId);
    return join(this.projectCwd, ".otto", "artifacts", `${artifactId}.html`);
  }
}

function generateArtifactId(): string {
  return randomBytes(4).toString("hex");
}
