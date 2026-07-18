import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Logger } from "pino";

import { writeJsonFileAtomic } from "../atomic-file.js";
import { AgentFeatureSchema, AgentStatusSchema } from "../messages.js";
import { toStoredAgentRecord } from "./agent-projections.js";
import type { ManagedAgent } from "./agent-manager.js";
import type { AgentSessionConfig } from "./agent-sdk-types.js";

// Frozen personality snapshot as stored on disk. Roles are kept as a loose
// string array here (not the PersonalityRole enum) so an old record whose role
// vocabulary drifted never fails to load — buildStoredAgentConfig re-normalizes
// them to the known set on read. Mirrors ResolvedPersonalitySnapshot.
const PERSONALITY_SNAPSHOT_STORAGE_SCHEMA = z
  .object({
    personalityId: z.string(),
    name: z.string(),
    provider: z.string(),
    model: z.string(),
    modeId: z.string().optional(),
    thinkingOptionId: z.string().optional(),
    effortLevel: z.string().optional(),
    effortMatch: z.enum(["exact-id", "level", "nearest"]).optional(),
    effortDegraded: z.boolean(),
    systemPrompt: z.string().optional(),
    respectGlobalAppendPrompt: z.boolean(),
    spinner: z.object({ glowA: z.string(), glowB: z.string() }).optional(),
    voice: z.object({ provider: z.string(), model: z.string(), name: z.string() }).optional(),
    roles: z.array(z.string()),
  })
  .nullable()
  .optional();

// Frozen born-team snapshot as stored on disk. Mirrors ResolvedTeamSnapshot;
// only prompt-recomposition and provenance fields are frozen, never membership.
const TEAM_SNAPSHOT_STORAGE_SCHEMA = z
  .object({
    teamId: z.string(),
    name: z.string(),
    avatarColor: z.string().optional(),
    teamPrompt: z.string().optional(),
  })
  .nullable()
  .optional();

const SERIALIZABLE_CONFIG_SCHEMA = z
  .object({
    modeId: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    thinkingOptionId: z.string().nullable().optional(),
    featureValues: z.record(z.string(), z.unknown()).nullable().optional(),
    extra: z.record(z.string(), z.any()).nullable().optional(),
    systemPrompt: z.string().nullable().optional(),
    mcpServers: z.record(z.string(), z.any()).nullable().optional(),
    personalitySnapshot: PERSONALITY_SNAPSHOT_STORAGE_SCHEMA,
    teamSnapshot: TEAM_SNAPSHOT_STORAGE_SCHEMA,
  })
  .nullable()
  .optional();

const PERSISTENCE_HANDLE_SCHEMA = z
  .object({
    provider: z.string(),
    sessionId: z.string(),
    nativeHandle: z.any().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  })
  .nullable()
  .optional();

const STORED_AGENT_SCHEMA = z.object({
  id: z.string(),
  provider: z.string(),
  cwd: z.string(),
  workspaceId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastActivityAt: z.string().optional(),
  lastUserMessageAt: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  labels: z.record(z.string(), z.string()).default({}),
  lastStatus: AgentStatusSchema.default("closed"),
  lastModeId: z.string().nullable().optional(),
  config: SERIALIZABLE_CONFIG_SCHEMA,
  runtimeInfo: z
    .object({
      provider: z.string(),
      sessionId: z.string().nullable(),
      model: z.string().nullable().optional(),
      thinkingOptionId: z.string().nullable().optional(),
      modeId: z.string().nullable().optional(),
      extra: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  features: z.array(AgentFeatureSchema).optional(),
  persistence: PERSISTENCE_HANDLE_SCHEMA,
  lastError: z.string().nullable().optional(),
  requiresAttention: z.boolean().optional(),
  attentionReason: z.enum(["finished", "error", "permission"]).nullable().optional(),
  attentionTimestamp: z.string().nullable().optional(),
  internal: z.boolean().optional(),
  // Guardrail (safe-unattended Phase 2): created-unattended flag plus the
  // running count / timestamp of policy-denied permission escalations. Additive
  // optional fields; older records simply omit them.
  unattended: z.boolean().optional(),
  guardrailDenials: z.number().optional(),
  lastGuardrailDenialAt: z.string().optional(),
  archivedAt: z.string().nullable().optional(),
});

export type SerializableAgentConfig = Pick<
  AgentSessionConfig,
  | "modeId"
  | "model"
  | "thinkingOptionId"
  | "featureValues"
  | "extra"
  | "systemPrompt"
  | "mcpServers"
  | "personalitySnapshot"
  | "teamSnapshot"
>;

export type StoredAgentRecord = z.infer<typeof STORED_AGENT_SCHEMA>;
export function parseStoredAgentRecord(value: unknown): StoredAgentRecord {
  return STORED_AGENT_SCHEMA.parse(value);
}

// Guardrail fields (safe-unattended Phase 2) are not rehydrated onto the live
// agent, so a resumed agent's fresh in-memory value would clobber the persisted
// running total on the next snapshot. Keep the larger count / most-recent
// timestamp and never drop a persisted `unattended` flag.
function preserveGuardrailFields(
  record: StoredAgentRecord,
  existing: StoredAgentRecord | null,
): void {
  if (!existing) {
    return;
  }
  if ((record.guardrailDenials ?? 0) < (existing.guardrailDenials ?? 0)) {
    record.guardrailDenials = existing.guardrailDenials;
  }
  if (record.lastGuardrailDenialAt === undefined && existing.lastGuardrailDenialAt !== undefined) {
    record.lastGuardrailDenialAt = existing.lastGuardrailDenialAt;
  }
  if (record.unattended === undefined && existing.unattended !== undefined) {
    record.unattended = existing.unattended;
  }
}

export class AgentStorage {
  private cache: Map<string, StoredAgentRecord> = new Map();
  private pathById: Map<string, string> = new Map();
  private pathsById: Map<string, Set<string>> = new Map();
  private pendingWrites: Map<string, Promise<void>> = new Map();
  private deleting: Set<string> = new Set();
  private loaded = false;
  private baseDir: string;
  private loadPromise: Promise<StoredAgentRecord[]> | null = null;
  private logger: Logger;

  constructor(baseDir: string, logger: Logger) {
    this.baseDir = baseDir;
    this.logger = logger.child({ module: "agent", component: "agent-storage" });
  }

  async initialize(): Promise<void> {
    await this.load();
  }

  async list(): Promise<StoredAgentRecord[]> {
    await this.load();
    return Array.from(this.cache.values());
  }

  async get(agentId: string): Promise<StoredAgentRecord | null> {
    await this.load();
    return this.cache.get(agentId) ?? null;
  }

  async upsert(record: StoredAgentRecord): Promise<void> {
    await this.load();
    await this.queueRecordWrite(record.id, () => record);
  }

  /**
   * Serialize a per-agent record write. The record is BUILT inside the chained
   * callback (after the previous write for this agent has fully settled — its
   * `writeRecord` cache.set included), not captured before enqueuing. That
   * closes a lost-update race for read-modify-write callers like
   * {@link applySnapshot}/{@link setTitle}: a title-less background persist that
   * would otherwise read a stale title before a concurrent `setTitle`, then
   * write it back afterwards, now re-reads the latest persisted title at the
   * moment it runs — so the newer title survives. The build callback returning
   * `null` skips the write (record vanished); throwing surfaces to the caller.
   */
  private queueRecordWrite(agentId: string, build: () => StoredAgentRecord | null): Promise<void> {
    const prev = this.pendingWrites.get(agentId) ?? Promise.resolve();
    // Sequence after the previous op settles either way, so one failed write
    // never poisons the writes queued behind it (the caller still observes this
    // op's own outcome via `tracked`).
    const next = prev.then(
      () => this.runRecordWrite(agentId, build),
      () => this.runRecordWrite(agentId, build),
    );

    const tracked = next.finally(() => {
      if (this.pendingWrites.get(agentId) === tracked) {
        this.pendingWrites.delete(agentId);
      }
    });

    this.pendingWrites.set(agentId, tracked);
    return tracked;
  }

  private async runRecordWrite(
    agentId: string,
    build: () => StoredAgentRecord | null,
  ): Promise<void> {
    if (this.deleting.has(agentId)) {
      return;
    }
    const record = build();
    if (!record) {
      return;
    }
    await this.writeRecord(record);
  }

  private async writeRecord(record: StoredAgentRecord): Promise<void> {
    const agentId = record.id;
    const nextPath = this.buildRecordPath(record);
    const previousPath = this.pathById.get(agentId);

    await writeJsonFileAtomic(nextPath, record);
    this.addIndexedPath(agentId, nextPath);

    if (previousPath && previousPath !== nextPath) {
      try {
        await fs.unlink(previousPath);
      } catch {
        // ignore cleanup errors
      }
      this.removeIndexedPath(agentId, previousPath);
    }

    this.cache.set(agentId, record);
    this.pathById.set(agentId, nextPath);
  }

  beginDelete(agentId: string): void {
    this.deleting.add(agentId);
  }

  async remove(agentId: string): Promise<void> {
    await this.load();
    this.beginDelete(agentId);
    await (this.pendingWrites.get(agentId) ?? Promise.resolve());
    const paths = Array.from(this.pathsById.get(agentId) ?? []);
    await Promise.all(
      paths.map(async (filePath) => {
        try {
          await fs.unlink(filePath);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code && code !== "ENOENT") {
            this.logger.warn(
              { err: error, agentId, filePath },
              "Failed to remove agent record file",
            );
          }
        }
      }),
    );

    this.cache.delete(agentId);
    this.pathById.delete(agentId);
    this.pathsById.delete(agentId);
  }

  async applySnapshot(
    agent: ManagedAgent,
    options?: { title?: string | null; internal?: boolean },
  ): Promise<void> {
    await this.load();
    const hasTitleOverride =
      options !== undefined && Object.prototype.hasOwnProperty.call(options, "title");
    const hasInternalOverride =
      options !== undefined && Object.prototype.hasOwnProperty.call(options, "internal");
    // Build inside the serialized write chain (see queueRecordWrite): `existing`
    // is read at the moment this write runs, so a title we mean to preserve
    // reflects any concurrent setTitle that has since landed instead of a stale
    // pre-enqueue snapshot.
    await this.queueRecordWrite(agent.id, () => {
      const existing = this.cache.get(agent.id) ?? null;
      const record = toStoredAgentRecord(agent, {
        title: hasTitleOverride ? (options?.title ?? null) : (existing?.title ?? null),
        createdAt: existing?.createdAt,
        internal: hasInternalOverride ? options?.internal : (agent.internal ?? existing?.internal),
      });

      // Preserve soft-delete/archive status across snapshot flushes.
      // `archivedAt` is not part of the ManagedAgent snapshot, so a naive projection
      // would wipe it during normal persistence (including on daemon restart).
      if (existing && existing.archivedAt !== undefined) {
        record.archivedAt = existing.archivedAt;
      }

      preserveGuardrailFields(record, existing);
      return record;
    });
  }

  async setTitle(agentId: string, title: string): Promise<void> {
    await this.load();
    await this.queueRecordWrite(agentId, () => {
      const record = this.cache.get(agentId) ?? null;
      if (!record) {
        throw new Error(`Agent ${agentId} not found`);
      }
      return { ...record, title };
    });
  }

  async flush(): Promise<void> {
    await this.load().catch(() => undefined);
    const writes = Array.from(this.pendingWrites.values());
    await Promise.allSettled(writes);
  }

  private async load(): Promise<StoredAgentRecord[]> {
    if (this.loaded) {
      return Array.from(this.cache.values());
    }

    if (!this.loadPromise) {
      this.loadPromise = this.doLoad();
    }

    return this.loadPromise;
  }

  private async doLoad(): Promise<StoredAgentRecord[]> {
    this.cache.clear();
    this.pathById.clear();
    this.pathsById.clear();

    try {
      const records = await this.scanDisk();
      this.loaded = true;
      return records;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.loaded = true;
        return [];
      }
      this.logger.error({ err: error }, "Failed to load agents");
      this.loaded = true;
      return [];
    }
  }

  private async scanDisk(): Promise<StoredAgentRecord[]> {
    const records: StoredAgentRecord[] = [];
    let entries: Array<import("node:fs").Dirent> = [];
    try {
      entries = await fs.readdir(this.baseDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const rootRecordPaths = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(this.baseDir, entry.name));

    const projectDirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(this.baseDir, entry.name));

    const projectFileLists = await Promise.all(
      projectDirs.map(async (projectDir) => {
        try {
          const files = await fs.readdir(projectDir, { withFileTypes: true });
          return files
            .filter((file) => file.isFile() && file.name.endsWith(".json"))
            .map((file) => path.join(projectDir, file.name));
        } catch {
          return [];
        }
      }),
    );

    const allFilePaths = [...rootRecordPaths, ...projectFileLists.flat()];
    const loaded = await Promise.all(
      allFilePaths.map(async (filePath) => {
        const record = await this.readRecordFile(filePath);
        return record ? { record, filePath } : null;
      }),
    );

    for (const item of loaded) {
      if (!item) continue;
      const { record, filePath } = item;
      records.push(record);
      this.cache.set(record.id, record);
      this.pathById.set(record.id, filePath);
      this.addIndexedPath(record.id, filePath);
    }

    return records;
  }

  private async readRecordFile(filePath: string): Promise<StoredAgentRecord | null> {
    try {
      const content = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(content);
      return parseStoredAgentRecord(parsed);
    } catch (error) {
      this.logger.error({ err: error, filePath }, "Skipping invalid agent record");
      return null;
    }
  }

  private buildRecordPath(record: StoredAgentRecord): string {
    const projectDir = projectDirNameFromCwd(record.cwd);
    return path.join(this.baseDir, projectDir, `${record.id}.json`);
  }

  private addIndexedPath(agentId: string, filePath: string): void {
    const paths = this.pathsById.get(agentId) ?? new Set<string>();
    paths.add(filePath);
    this.pathsById.set(agentId, paths);
  }

  private removeIndexedPath(agentId: string, filePath: string): void {
    const paths = this.pathsById.get(agentId);
    if (!paths) {
      return;
    }
    paths.delete(filePath);
    if (paths.size === 0) {
      this.pathsById.delete(agentId);
    }
  }
}

function projectDirNameFromCwd(cwd: string): string {
  // path.win32.parse handles drive letters, UNC roots, and Unix roots on all platforms
  const { root } = path.win32.parse(cwd);
  const withoutRoot = cwd.slice(root.length).replace(/[\\/]+$/, "");
  // Sanitize root: strip colons and separators, keep letters (e.g. "C:\" → "C", "\\server\share\" → "server-share")
  const sanitizedRoot = root.replace(/[:\\/]+/g, "-").replace(/^-+|-+$/g, "");
  const prefix = sanitizedRoot ? sanitizedRoot + "-" : "";
  if (!withoutRoot) {
    return sanitizedRoot || "root";
  }
  return prefix + withoutRoot.replace(/[\\/]+/g, "-");
}
