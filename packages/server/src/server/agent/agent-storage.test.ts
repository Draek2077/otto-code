import { describe, expect, test, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { promises as fs } from "node:fs";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentStorage, parseStoredAgentRecord, type StoredAgentRecord } from "./agent-storage.js";
import { buildConfigOverrides, buildSessionConfig } from "../persistence-hooks.js";
import type { ManagedAgent } from "./agent-manager.js";
import type {
  AgentPermissionRequest,
  AgentProvider,
  AgentSession,
  AgentSessionConfig,
} from "./agent-sdk-types.js";

type ManagedAgentOverrides = Omit<
  Partial<ManagedAgent>,
  "config" | "pendingPermissions" | "session" | "activeForegroundTurnId"
> & {
  config?: Partial<AgentSessionConfig>;
  pendingPermissions?: Map<string, AgentPermissionRequest>;
  session?: AgentSession | null;
  activeForegroundTurnId?: string | null;
  runtimeInfo?: ManagedAgent["runtimeInfo"];
  attention?: ManagedAgent["attention"];
};

function buildManagedAgentConfig(
  provider: AgentProvider,
  cwd: string,
  configOverrides: Partial<AgentSessionConfig>,
): AgentSessionConfig {
  const config: AgentSessionConfig = {
    provider,
    cwd,
    title: configOverrides.title,
    modeId: configOverrides.modeId ?? "plan",
    model: configOverrides.model ?? "gpt-5.1",
    thinkingOptionId: configOverrides.thinkingOptionId,
    providerOptions: configOverrides.providerOptions,
    toolPolicy: configOverrides.toolPolicy,
    systemPrompt: configOverrides.systemPrompt,
    mcpServers: configOverrides.mcpServers,
  };
  if (Object.prototype.hasOwnProperty.call(configOverrides, "featureValues")) {
    config.featureValues = configOverrides.featureValues;
  }
  return config;
}

function buildDefaultCapabilities() {
  return {
    supportsStreaming: true,
    supportsSessionPersistence: true,
    supportsDynamicModes: true,
    supportsMcpServers: true,
    supportsReasoningStream: true,
    supportsToolInvocations: true,
  };
}

function buildDefaultRuntimeInfo(params: {
  provider: AgentProvider;
  config: AgentSessionConfig;
  sessionId: string;
}) {
  return {
    provider: params.provider,
    sessionId: params.sessionId,
    model: params.config.model ?? null,
    modeId: params.config.modeId ?? null,
  };
}

interface ManagedAgentCore {
  provider: AgentProvider;
  cwd: string;
  lifecycle: ManagedAgent["lifecycle"];
  config: AgentSessionConfig;
  session: AgentSession | null;
  activeForegroundTurnId: string | null;
  now: Date;
}

function resolveManagedAgentCore(overrides: ManagedAgentOverrides): ManagedAgentCore {
  const now = overrides.updatedAt ?? new Date("2025-01-01T00:00:00.000Z");
  const provider = overrides.provider ?? "claude";
  const cwd = overrides.cwd ?? "/tmp/project";
  const lifecycle = overrides.lifecycle ?? "idle";
  const config = buildManagedAgentConfig(provider, cwd, overrides.config ?? {});
  const session = lifecycle === "closed" ? null : (overrides.session ?? ({} as AgentSession));
  const activeForegroundTurnId =
    overrides.activeForegroundTurnId ?? (lifecycle === "running" ? "test-turn-id" : null);
  return { provider, cwd, lifecycle, config, session, activeForegroundTurnId, now };
}

function createManagedAgent(overrides: ManagedAgentOverrides = {}): ManagedAgent {
  const core = resolveManagedAgentCore(overrides);
  return {
    id: overrides.id ?? "agent-test",
    provider: core.provider,
    cwd: core.cwd,
    workspaceId: overrides.workspaceId,
    session: core.session,
    capabilities: overrides.capabilities ?? buildDefaultCapabilities(),
    config: core.config,
    lifecycle: core.lifecycle,
    createdAt: overrides.createdAt ?? core.now,
    updatedAt: overrides.updatedAt ?? core.now,
    availableModes: overrides.availableModes ?? [],
    currentModeId: overrides.currentModeId ?? core.config.modeId ?? null,
    pendingPermissions: overrides.pendingPermissions ?? new Map<string, AgentPermissionRequest>(),
    activeForegroundTurnId: core.activeForegroundTurnId,
    steerQueue: [],
    foregroundTurnWaiters: new Set(),
    unsubscribeSession: null,
    timeline: overrides.timeline ?? [],
    attention: overrides.attention ?? { requiresAttention: false },
    runtimeInfo:
      overrides.runtimeInfo ??
      buildDefaultRuntimeInfo({
        provider: core.provider,
        config: core.config,
        sessionId: overrides.sessionId ?? "session-123",
      }),
    persistence: overrides.persistence ?? null,
    historyPrimed: overrides.historyPrimed ?? true,
    lastUserMessageAt: overrides.lastUserMessageAt ?? core.now,
    lastUsage: overrides.lastUsage,
    lastError: overrides.lastError,
  };
}

describe("AgentStorage", () => {
  let tmpDir: string;
  let storagePath: string;
  let storage: AgentStorage;
  const logger = createTestLogger();

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "agent-registry-"));
    storagePath = path.join(tmpDir, "agents");
    storage = new AgentStorage(storagePath, logger);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("applySnapshot persists configs and snapshot metadata", async () => {
    await storage.applySnapshot(
      createManagedAgent({
        id: "agent-1",
        cwd: "/tmp/project",
        currentModeId: "coding",
        lifecycle: "idle",
        config: {
          title: "Initial title",
          modeId: "coding",
          model: "gpt-5.1",
          systemPrompt: "Be terse and explicit.",
          providerOptions: { allowedTools: ["Read"] },
          mcpServers: {
            otto: {
              type: "stdio",
              command: "node",
              args: ["/tmp/mcp-stdio-socket-bridge-cli.mjs", "--socket", "/tmp/test.sock"],
            },
          },
        },
      }),
    );

    const records = await storage.list();
    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record.provider).toBe("claude");
    expect(record.config?.modeId).toBe("coding");
    expect(record.config?.model).toBe("gpt-5.1");
    expect(record.config?.systemPrompt).toBe("Be terse and explicit.");
    expect(record.config?.mcpServers).toEqual({
      otto: {
        type: "stdio",
        command: "node",
        args: ["/tmp/mcp-stdio-socket-bridge-cli.mjs", "--socket", "/tmp/test.sock"],
      },
    });
    expect(record.lastModeId).toBe("coding");
    expect(record.lastStatus).toBe("idle");

    const reloaded = new AgentStorage(storagePath, logger);
    const [persisted] = await reloaded.list();
    expect(persisted.cwd).toBe("/tmp/project");
    expect(persisted.config?.providerOptions).toEqual({ allowedTools: ["Read"] });
  });

  test("applySnapshot stores and reloads featureValues when present", async () => {
    await storage.applySnapshot(
      createManagedAgent({
        id: "agent-feature-values",
        config: {
          featureValues: {
            fast_mode: true,
          },
        },
      }),
    );

    const record = await storage.get("agent-feature-values");
    expect(record?.config?.featureValues).toEqual({ fast_mode: true });

    const reloaded = new AgentStorage(storagePath, logger);
    const persisted = await reloaded.get("agent-feature-values");
    expect(persisted?.config?.featureValues).toEqual({ fast_mode: true });
    expect(buildSessionConfig(persisted!).featureValues).toEqual({ fast_mode: true });
  });

  test("applySnapshot keeps featureValues absent when they were never set", async () => {
    await storage.applySnapshot(
      createManagedAgent({
        id: "agent-no-feature-values",
      }),
    );

    const reloaded = new AgentStorage(storagePath, logger);
    const persisted = await reloaded.get("agent-no-feature-values");
    expect(persisted?.config?.featureValues).toBeUndefined();
    expect(buildSessionConfig(persisted!).featureValues).toBeUndefined();
  });

  test("buildConfigOverrides includes featureValues when present in stored config", async () => {
    await storage.applySnapshot(
      createManagedAgent({
        id: "agent-resume-overrides",
        config: {
          featureValues: {
            fast_mode: true,
          },
        },
      }),
    );

    const record = await storage.get("agent-resume-overrides");
    expect(record).not.toBeNull();
    expect(buildConfigOverrides(record!)).toMatchObject({
      cwd: "/tmp/project",
      featureValues: {
        fast_mode: true,
      },
    });
  });

  test("applySnapshot preserves original createdAt timestamp", async () => {
    const agentId = "agent-created-at";
    const firstTimestamp = new Date("2025-01-01T00:00:00.000Z");
    await storage.applySnapshot(createManagedAgent({ id: agentId, createdAt: firstTimestamp }));

    const initialRecord = await storage.get(agentId);
    expect(initialRecord?.createdAt).toBe(firstTimestamp.toISOString());

    await storage.applySnapshot(
      createManagedAgent({
        id: agentId,
        createdAt: new Date("2025-02-01T00:00:00.000Z"),
        updatedAt: new Date("2025-02-01T00:00:00.000Z"),
        lifecycle: "running",
      }),
    );

    const updatedRecord = await storage.get(agentId);
    expect(updatedRecord?.createdAt).toBe(firstTimestamp.toISOString());
    expect(updatedRecord?.lastStatus).toBe("running");
  });

  test("applySnapshot preserves archivedAt (soft-delete) status", async () => {
    const agentId = "agent-archived";
    await storage.applySnapshot(
      createManagedAgent({
        id: agentId,
        lifecycle: "idle",
      }),
    );

    const archivedAt = "2025-01-03T00:00:00.000Z";
    const recordBeforeArchive = await storage.get(agentId);
    expect(recordBeforeArchive).not.toBeNull();
    await storage.upsert({ ...recordBeforeArchive!, archivedAt });

    await storage.applySnapshot(
      createManagedAgent({
        id: agentId,
        lifecycle: "running",
        updatedAt: new Date("2025-01-04T00:00:00.000Z"),
      }),
    );

    const recordAfterSnapshot = await storage.get(agentId);
    expect(recordAfterSnapshot?.archivedAt).toBe(archivedAt);
  });

  test("stores titles independently of snapshots", async () => {
    await storage.applySnapshot(
      createManagedAgent({
        id: "agent-2",
        provider: "codex",
        cwd: "/tmp/second",
      }),
    );
    await storage.setTitle("agent-2", "Fix Login Bug");

    const current = await storage.get("agent-2");
    expect(current?.title).toBe("Fix Login Bug");

    const reloaded = new AgentStorage(storagePath, logger);
    const persisted = await reloaded.get("agent-2");
    expect(persisted?.title).toBe("Fix Login Bug");
  });

  test("setTitle throws when the agent record does not exist", async () => {
    await expect(storage.setTitle("missing-agent", "Impossible")).rejects.toThrow(
      "Agent missing-agent not found",
    );
  });

  test("applySnapshot accepts explicit title overrides", async () => {
    const agentId = "agent-override";
    await storage.applySnapshot(createManagedAgent({ id: agentId }), { title: "Provided Title" });

    const record = await storage.get(agentId);
    expect(record?.title).toBe("Provided Title");
  });

  test("applySnapshot preserves custom titles while updating metadata", async () => {
    const agentId = "agent-3";
    await storage.applySnapshot(
      createManagedAgent({
        id: agentId,
        lifecycle: "idle",
        currentModeId: "plan",
      }),
    );
    await storage.setTitle(agentId, "Important Bug Fix");

    await storage.applySnapshot(
      createManagedAgent({
        id: agentId,
        lifecycle: "running",
        currentModeId: "build",
        updatedAt: new Date("2025-01-02T00:00:00.000Z"),
      }),
    );

    const record = await storage.get(agentId);
    expect(record?.title).toBe("Important Bug Fix");
    expect(record?.lastModeId).toBe("build");
    expect(record?.lastStatus).toBe("running");
  });

  test("applySnapshot projects metadata after in-flight archival writes", async () => {
    const agentId = "agent-pending-write";
    await storage.applySnapshot(createManagedAgent({ id: agentId }));
    const initialRecord = await storage.get(agentId);
    expect(initialRecord).not.toBeNull();

    let releasePendingWrite: (() => void) | null = null;
    const pendingWrite = new Promise<void>((resolve) => {
      releasePendingWrite = resolve;
    });

    const storageInternals = storage as unknown as {
      pendingWrites: Map<string, Promise<void>>;
      cache: Map<string, unknown>;
    };
    storageInternals.pendingWrites.set(agentId, pendingWrite);

    const applySnapshotPromise = storage.applySnapshot(
      createManagedAgent({
        id: agentId,
        lifecycle: "running",
        updatedAt: new Date("2025-01-02T00:00:00.000Z"),
      }),
    );

    storageInternals.cache.set(agentId, {
      ...initialRecord!,
      title: "Generated title",
      archivedAt: "2025-01-03T00:00:00.000Z",
    });
    releasePendingWrite?.();

    await applySnapshotPromise;
    const record = await storage.get(agentId);
    expect(record?.title).toBe("Generated title");
    expect(record?.archivedAt).toBe("2025-01-03T00:00:00.000Z");
  });

  test("a concurrent streaming persist never rolls a fresh title back to the provisional", async () => {
    const agentId = "agent-title-race";
    // Chat starts with the provisional first-line title.
    await storage.applySnapshot(createManagedAgent({ id: agentId }), {
      title: "First prompt line",
    });

    // The auto-title writer's setTitle and a streaming background persist (a
    // title-less applySnapshot, which is meant to PRESERVE the stored title)
    // fire around the same tick. The persist must not read the stale provisional
    // title and write it back over the freshly generated one - the lost-update
    // race that made the visualizer/chat title snap back to the first prompt.
    await Promise.all([
      storage.setTitle(agentId, "AI Title"),
      storage.applySnapshot(createManagedAgent({ id: agentId, lifecycle: "running" })),
    ]);
    expect((await storage.get(agentId))?.title).toBe("AI Title");

    // Same guarantee with the enqueue order reversed (persist first, then the
    // title write).
    await Promise.all([
      storage.applySnapshot(
        createManagedAgent({
          id: agentId,
          lifecycle: "idle",
          updatedAt: new Date("2025-02-01T00:00:00.000Z"),
        }),
      ),
      storage.setTitle(agentId, "AI Title v2"),
    ]);
    expect((await storage.get(agentId))?.title).toBe("AI Title v2");

    const reloaded = new AgentStorage(storagePath, logger);
    expect((await reloaded.get(agentId))?.title).toBe("AI Title v2");
  });

  test("list returns all agents including internal ones", async () => {
    // Create a normal agent
    await storage.applySnapshot(
      createManagedAgent({
        id: "normal-agent",
        cwd: "/tmp/project",
      }),
    );

    // Create an internal agent
    await storage.applySnapshot(
      createManagedAgent({
        id: "internal-agent",
        cwd: "/tmp/project",
        config: { internal: true },
      }),
      { internal: true },
    );

    // Registry should return all agents - filtering is done at the manager level
    const records = await storage.list();
    expect(records).toHaveLength(2);
  });

  test("get returns internal agents by ID", async () => {
    await storage.applySnapshot(
      createManagedAgent({
        id: "internal-agent",
        cwd: "/tmp/project",
        config: { internal: true },
      }),
      { internal: true },
    );

    const record = await storage.get("internal-agent");
    expect(record).not.toBeNull();
    expect(record?.internal).toBe(true);
  });

  test("queries agents by provider session and native handle", async () => {
    await storage.applySnapshot(
      createManagedAgent({
        id: "matching-session",
        provider: "codex",
        persistence: {
          provider: "codex",
          sessionId: "session-1",
          nativeHandle: "thread-1",
        },
      }),
    );
    await storage.applySnapshot(
      createManagedAgent({
        id: "other-session",
        provider: "codex",
        persistence: { provider: "codex", sessionId: "session-2" },
      }),
    );

    await expect(storage.listByProviderSession("codex", "session-1")).resolves.toMatchObject([
      { id: "matching-session" },
    ]);
    await expect(storage.listByProviderSession("codex", "thread-1")).resolves.toMatchObject([
      { id: "matching-session" },
    ]);
  });

  test("queries agents by workspace", async () => {
    await storage.applySnapshot(
      createManagedAgent({ id: "workspace-agent", workspaceId: "workspace-1" }),
    );
    await storage.applySnapshot(
      createManagedAgent({ id: "other-workspace-agent", workspaceId: "workspace-2" }),
    );

    await expect(storage.listByWorkspace("workspace-1")).resolves.toMatchObject([
      { id: "workspace-agent" },
    ]);
  });

  test("internal flag is persisted and reloaded", async () => {
    await storage.applySnapshot(
      createManagedAgent({
        id: "internal-agent",
        cwd: "/tmp/project",
        config: { internal: true },
      }),
      { internal: true },
    );

    // Reload the registry from disk
    const reloaded = new AgentStorage(storagePath, logger);
    const record = await reloaded.get("internal-agent");
    expect(record?.internal).toBe(true);

    // Registry returns all agents - filtering happens at manager level
    const records = await reloaded.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.internal).toBe(true);
  });

  test("Windows drive-letter paths produce valid directory names", async () => {
    await storage.applySnapshot(
      createManagedAgent({
        id: "win-agent",
        cwd: "D:\\Users\\dev\\MyProject",
      }),
    );

    const record = await storage.get("win-agent");
    expect(record).not.toBeNull();

    // The persisted directory must not contain a colon (invalid on Windows)
    const dirs = readdirSync(storagePath);
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).not.toContain(":");
    expect(dirs[0]).toBe("D-Users-dev-MyProject");
  });

  test("remove deletes all duplicate record files across project directories", async () => {
    const agentId = "agent-duplicate";

    // Create a valid record file in two different project directories to simulate
    // storage migrations/duplication. Only one copy will be referenced in-memory,
    // but deletion should remove *all* copies on disk.
    const recordA = await (async () => {
      await storage.applySnapshot(
        createManagedAgent({
          id: agentId,
          cwd: "/tmp/project-a",
          provider: "codex",
        }),
      );
      const record = await storage.get(agentId);
      expect(record).not.toBeNull();
      return record!;
    })();

    const projectDirB = path.join(storagePath, "tmp-project-b");
    await fs.mkdir(projectDirB, { recursive: true });
    const duplicatePathB = path.join(projectDirB, `${agentId}.json`);
    await fs.writeFile(
      duplicatePathB,
      JSON.stringify({ ...recordA, cwd: "/tmp/project-b" }, null, 2),
      "utf8",
    );

    // Force a reload so the registry has to discover from disk (and may choose either copy).
    const reloaded = new AgentStorage(storagePath, logger);
    const before = await reloaded.list();
    expect(before.map((r) => r.id)).toContain(agentId);

    await reloaded.remove(agentId);

    const hasAnyRecordFile = async () => {
      const projects = await fs
        .readdir(storagePath, { withFileTypes: true })
        .catch(() => [] as Awaited<ReturnType<typeof fs.readdir>>);
      const exists = await Promise.all(
        projects
          .filter((project) => project.isDirectory())
          .map(async (project) => {
            const candidate = path.join(storagePath, project.name, `${agentId}.json`);
            try {
              await fs.access(candidate);
              return true;
            } catch {
              return false;
            }
          }),
      );
      return exists.some((present) => present);
    };

    expect(await hasAnyRecordFile()).toBe(false);

    const afterReload = new AgentStorage(storagePath, logger);
    const after = await afterReload.list();
    expect(after.some((r) => r.id === agentId)).toBe(false);
  });

  // The workspace half of the owner index. The descriptor rebuild that runs on
  // every agent lifecycle event asks for one workspace's records; a seeded home
  // carries thousands, so this has to answer without walking the cache.
  async function seedOwnedRecords(
    records: Array<{ id: string; workspaceId?: string }>,
  ): Promise<void> {
    for (const input of records) {
      await storage.upsert(ownedRecord(input));
    }
  }

  test("list(scope) returns only the records owned by the requested workspaces", async () => {
    await seedOwnedRecords([
      { id: "a-1", workspaceId: "ws-a" },
      { id: "a-2", workspaceId: "ws-a" },
      { id: "b-1", workspaceId: "ws-b" },
      { id: "unowned" },
    ]);

    const scoped = await storage.list({ workspaceIds: new Set(["ws-a"]) });

    expect(scopedIds(scoped)).toEqual(["a-1", "a-2"]);
  });

  test("list(scope) adds records named by id, deduped against the workspace hits", async () => {
    await seedOwnedRecords([
      { id: "a-1", workspaceId: "ws-a" },
      { id: "b-1", workspaceId: "ws-b" },
      { id: "unowned" },
    ]);

    const scoped = await storage.list({
      workspaceIds: new Set(["ws-a"]),
      agentIds: new Set(["a-1", "b-1", "unowned", "never-existed"]),
    });

    expect(scopedIds(scoped)).toEqual(["a-1", "b-1", "unowned"]);
  });

  test("a record that moves workspace leaves its old workspace's scope", async () => {
    await seedOwnedRecords([{ id: "mover", workspaceId: "ws-a" }]);

    await storage.upsert(ownedRecord({ id: "mover", workspaceId: "ws-b" }));

    const inOldWorkspace = await storage.list({ workspaceIds: new Set(["ws-a"]) });
    const inNewWorkspace = await storage.list({ workspaceIds: new Set(["ws-b"]) });
    expect(scopedIds(inOldWorkspace)).toEqual([]);
    expect(scopedIds(inNewWorkspace)).toEqual(["mover"]);
  });

  test("a removed record leaves its workspace's scope", async () => {
    await seedOwnedRecords([
      { id: "a-1", workspaceId: "ws-a" },
      { id: "a-2", workspaceId: "ws-a" },
    ]);

    await storage.remove("a-1");

    const scoped = await storage.list({ workspaceIds: new Set(["ws-a"]) });
    expect(scopedIds(scoped)).toEqual(["a-2"]);
  });

  test("the workspace owner index survives a cold reload from disk", async () => {
    await seedOwnedRecords([
      { id: "a-1", workspaceId: "ws-a" },
      { id: "b-1", workspaceId: "ws-b" },
    ]);

    const reloaded = new AgentStorage(storagePath, logger);
    const scoped = await reloaded.list({ workspaceIds: new Set(["ws-b"]) });

    expect(scopedIds(scoped)).toEqual(["b-1"]);
  });

  test("an empty scope matches nothing, rather than falling back to everything", async () => {
    await seedOwnedRecords([{ id: "a-1", workspaceId: "ws-a" }]);

    const scoped = await storage.list({});
    expect(scopedIds(scoped)).toEqual([]);
  });
});

function ownedRecord(input: { id: string; workspaceId?: string }): StoredAgentRecord {
  return {
    id: input.id,
    provider: "claude",
    cwd: "/tmp/project",
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    createdAt: "2026-03-01T12:00:00.000Z",
    updatedAt: "2026-03-01T12:00:00.000Z",
    labels: {},
    lastStatus: "idle",
  };
}

function scopedIds(records: StoredAgentRecord[]): string[] {
  return records.map((record) => record.id).sort();
}

// COMPAT(profileSnapshotKey): added in v0.8.13, remove after 2027-02-22.
// A stored agent written before the personality/profile convergence carries
// `config.personalitySnapshot` with a `personalityId` inside it. Loading has to
// tolerate that shape forever-until-the-date, and converge the file while it is
// at it. This touches real user data, so it is tested against files on disk
// rather than through the parse helper alone.
describe("AgentStorage pre-convergence records", () => {
  let tmpDir: string;
  let storagePath: string;
  let storage: AgentStorage;
  const logger = createTestLogger();

  const legacySnapshot = {
    personalityId: "personality_builtin_sage",
    name: "Sage",
    provider: "claude",
    model: "claude-opus-4-8",
    effortDegraded: false,
    respectGlobalAppendPrompt: true,
    roles: ["advisor"],
  };

  function legacyRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "legacy-agent",
      provider: "claude",
      cwd: "/tmp/legacy-project",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      labels: {},
      lastStatus: "closed",
      config: { model: "claude-opus-4-8", personalitySnapshot: legacySnapshot },
      ...overrides,
    };
  }

  async function writeLegacyFile(record: Record<string, unknown>): Promise<string> {
    // Mirrors projectDirNameFromCwd for "/tmp/legacy-project": the root "/"
    // sanitizes away entirely, so there is no leading separator.
    const dir = path.join(storagePath, "tmp-legacy-project");
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${String(record["id"])}.json`);
    await fs.writeFile(filePath, JSON.stringify(record, null, 2), "utf8");
    return filePath;
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "agent-registry-legacy-"));
    storagePath = path.join(tmpDir, "agents");
    storage = new AgentStorage(storagePath, logger);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("renames the keys on parse", () => {
    const parsed = parseStoredAgentRecord(legacyRecord());
    expect(parsed.config?.profileSnapshot?.profileId).toBe("personality_builtin_sage");
  });

  test("loads a record written under the old keys", async () => {
    await writeLegacyFile(legacyRecord());

    const loaded = await storage.list();
    const record = loaded.find((entry) => entry.id === "legacy-agent");

    expect(record?.config?.profileSnapshot?.profileId).toBe("personality_builtin_sage");
    expect(record?.config?.profileSnapshot?.name).toBe("Sage");
  });

  test("rewrites the file so the store converges", async () => {
    const filePath = await writeLegacyFile(legacyRecord());
    await storage.list();

    const onDisk = JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
    const config = onDisk["config"] as Record<string, unknown>;
    expect(config).not.toHaveProperty("personalitySnapshot");
    expect((config["profileSnapshot"] as Record<string, unknown>)["profileId"]).toBe(
      "personality_builtin_sage",
    );
    expect(config["profileSnapshot"]).not.toHaveProperty("personalityId");
  });

  test("keeps unknown fields a newer daemon wrote", async () => {
    // A migration has no business dropping a field it does not recognize, so
    // the normalized RAW json is written rather than the parsed record.
    const filePath = await writeLegacyFile(legacyRecord({ somethingNewer: { keep: "me" } }));
    await storage.list();

    const onDisk = JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
    expect(onDisk["somethingNewer"]).toEqual({ keep: "me" });
  });

  test("leaves an already-converged record untouched", async () => {
    const converged = legacyRecord({
      id: "modern-agent",
      config: {
        model: "claude-opus-4-8",
        profileSnapshot: { ...legacySnapshot, personalityId: undefined, profileId: "p-modern" },
      },
    });
    const filePath = await writeLegacyFile(converged);
    const before = await fs.readFile(filePath, "utf8");

    await storage.list();

    expect(await fs.readFile(filePath, "utf8")).toBe(before);
  });

  test("prefers the new key when a record somehow carries both", async () => {
    // Only possible if an older daemon appended the legacy key back onto a file
    // a newer one had already migrated.
    await writeLegacyFile(
      legacyRecord({
        id: "both-keys-agent",
        config: {
          model: "claude-opus-4-8",
          personalitySnapshot: legacySnapshot,
          profileSnapshot: { ...legacySnapshot, personalityId: undefined, profileId: "p-winner" },
        },
      }),
    );

    const loaded = await storage.list();
    const record = loaded.find((entry) => entry.id === "both-keys-agent");

    expect(record?.config?.profileSnapshot?.profileId).toBe("p-winner");
  });
});
