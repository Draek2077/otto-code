import { describe, expect, it } from "vitest";

import { AGENT_LIFECYCLE_STATUSES } from "./agent-manager.js";
import {
  deriveObservedSubagentTitle,
  observedUpdateHasTitleSource,
  buildStoredAgentPayload,
  toAgentPayload,
  toObservedSubagentPayload,
  toRecentProviderSessionDescriptorPayload,
  toStoredAgentRecord,
  type ManagedAgent,
} from "./agent-projections.js";
import { parseStoredAgentRecord } from "./agent-storage.js";
import type { ResolvedProfileSnapshot } from "./agent-profiles.js";
import type { AgentSession } from "./agent-sdk-types.js";
import type {
  AgentFeature,
  ImportableProviderSession,
  AgentPermissionRequest,
  AgentPersistenceHandle,
  AgentSessionConfig,
} from "./agent-sdk-types.js";

type ManagedAgentOverrides = Omit<Partial<ManagedAgent>, "config" | "pendingPermissions"> & {
  config?: Partial<AgentSessionConfig>;
  pendingPermissions?: Map<string, AgentPermissionRequest>;
};

function createManagedAgent(overrides: ManagedAgentOverrides = {}): ManagedAgent {
  const now = new Date("2025-01-01T00:00:00.000Z");
  const baseConfig: AgentSessionConfig = {
    provider: "claude",
    cwd: "/tmp/project",
    modeId: "plan",
    model: "claude-3.5-sonnet",
    providerOptions: { allowedTools: ["Read"] },
  };

  const basePersistence: AgentPersistenceHandle = {
    provider: "claude",
    sessionId: "persist-1",
    metadata: { branch: "feature/refactor" },
  };

  const configOverrides = overrides.config ?? {};
  const {
    config: _ignoredConfig,
    pendingPermissions: pendingPermissionsOverride,
    lifecycle = "idle",
    ...restOverrides
  } = overrides;

  const sessionValue =
    lifecycle === "closed" ? null : (restOverrides.session ?? ({} as AgentSession));
  const activeForegroundTurnIdValue =
    restOverrides.activeForegroundTurnId ?? (lifecycle === "running" ? "test-turn-id" : null);
  const lastErrorValue =
    restOverrides.lastError ?? (lifecycle === "error" ? "encountered error" : undefined);

  const agent: ManagedAgent = {
    id: "agent-123",
    provider: "claude",
    cwd: "/tmp/project",
    session: sessionValue,
    sessionId: "session-123",
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    config: { ...baseConfig, ...configOverrides },
    lifecycle,
    createdAt: now,
    updatedAt: now,
    availableModes: [
      { id: "plan", label: "Planning" },
      { id: "build", label: "Building", description: "Detailed" },
    ],
    currentModeId: "plan",
    pendingPermissions: pendingPermissionsOverride ?? new Map<string, AgentPermissionRequest>(),
    activeForegroundTurnId: activeForegroundTurnIdValue,
    steerQueue: [],
    activeTurnId: activeForegroundTurnIdValue,
    activeTurnStartedAt: lifecycle === "running" ? new Date("2025-01-01T00:00:01.000Z") : null,
    foregroundTurnWaiters: new Set(),
    unsubscribeSession: null,
    timeline: [],
    runtimeInfo: {
      provider: "claude",
      sessionId: "session-123",
      model: "claude-3.5-sonnet",
      modeId: "plan",
    },
    persistence: { ...basePersistence },
    lastUsage: undefined,
    lastError: lastErrorValue,
    historyPrimed: true,
    lastUserMessageAt: now,
    attention: { requiresAttention: false },
  };

  return {
    ...agent,
    ...restOverrides,
    lifecycle,
    config: agent.config,
    pendingPermissions: agent.pendingPermissions,
  };
}

it("projects the daemon-owned active turn identity", () => {
  expect(toAgentPayload(createManagedAgent({ lifecycle: "running" })).activeTurn).toEqual({
    turnId: "test-turn-id",
    startedAt: "2025-01-01T00:00:01.000Z",
  });
});

it("does not expose an invalid turn identity once the agent is no longer running", () => {
  // An idle/error agent cannot have a live turn. Keep the wire invariant even
  // for an older or malformed in-memory record that still carries an identity.
  const settled = createManagedAgent({
    lifecycle: "idle",
    activeTurnId: "foreground-turn-1",
    activeTurnStartedAt: new Date("2025-01-01T00:00:01.000Z"),
  });
  expect(toAgentPayload(settled).activeTurn).toBeNull();

  const failed = createManagedAgent({
    lifecycle: "error",
    activeTurnId: "foreground-turn-1",
    activeTurnStartedAt: new Date("2025-01-01T00:00:01.000Z"),
  });
  expect(toAgentPayload(failed).activeTurn).toBeNull();
});

function createPermission(overrides: Partial<AgentPermissionRequest> = {}): AgentPermissionRequest {
  const base: AgentPermissionRequest = {
    id: "perm-1",
    provider: "claude",
    name: "execute_command",
    kind: "tool",
    title: "Run command",
    description: "Execute shell command",
    input: { command: "ls", args: undefined },
    suggestions: [{ behavior: "allow" }],
    metadata: { requestedAt: new Date("2025-02-01T12:00:00.000Z") },
  };
  return { ...base, ...overrides };
}

function createFeature(overrides: Partial<AgentFeature> = {}): AgentFeature {
  return {
    type: "toggle",
    id: "fast_mode",
    label: "Fast mode",
    value: true,
    ...overrides,
  };
}

describe("toStoredAgentRecord", () => {
  it("captures lifecycle metadata, config, and persistence", () => {
    const agent = createManagedAgent({
      currentModeId: "focus",
      persistence: {
        provider: "claude",
        sessionId: "persist-2",
        metadata: { resumedAt: new Date("2025-01-05T00:00:00.000Z"), note: "warm" },
      },
    });

    const record = toStoredAgentRecord(agent, { title: "Refactor Agent" });

    expect(record).toMatchObject({
      id: agent.id,
      provider: agent.provider,
      cwd: agent.cwd,
      title: "Refactor Agent",
      lastStatus: agent.lifecycle,
      lastModeId: "focus",
    });
    expect(record.createdAt).toBe(agent.createdAt.toISOString());
    expect(record.updatedAt).toBe(agent.updatedAt.toISOString());
    expect(record.lastActivityAt).toBe(agent.updatedAt.toISOString());
    expect(record.lastUserMessageAt).toBe(agent.lastUserMessageAt?.toISOString());
    expect(record.persistence).toEqual({
      provider: "claude",
      sessionId: "persist-2",
      metadata: {
        resumedAt: "2025-01-05T00:00:00.000Z",
        note: "warm",
      },
    });
    expect(record.runtimeInfo).toEqual({
      provider: "claude",
      sessionId: "session-123",
      model: "claude-3.5-sonnet",
      modeId: "plan",
    });
    expect(record.config).toEqual({
      modeId: agent.config.modeId,
      model: agent.config.model,
      providerOptions: { allowedTools: ["Read"] },
    });

    record.config!.providerOptions!.allowedTools = ["Bash"];
    expect(agent.config.providerOptions!.allowedTools).toEqual(["Read"]);
    record.persistence!.sessionId = "mutated";
    expect(agent.persistence!.sessionId).toBe("persist-2");
  });

  it("round-trips a personality snapshot through storage", () => {
    const snapshot: ResolvedProfileSnapshot = {
      profileId: "p1",
      name: "Aria",
      provider: "codex",
      model: "gpt-5.4",
      modeId: "auto",
      thinkingOptionId: "high",
      effortLevel: "high",
      effortMatch: "level",
      effortDegraded: false,
      systemPrompt: "You are Aria.",
      respectGlobalAppendPrompt: false,
      spinner: { glowA: "#111111", glowB: "#222222" },
      voice: { provider: "kokoro", model: "kokoro-multi-lang-v1_0", name: "af_heart" },
      roles: ["chatter", "orchestrator"],
    };
    const agent = createManagedAgent({ config: { profileSnapshot: snapshot } });

    const record = toStoredAgentRecord(agent, { title: "Aria" });
    expect(record.config?.profileSnapshot).toEqual(snapshot);

    // Survives the storage zod parse (the on-disk read path).
    const parsed = parseStoredAgentRecord(record);
    expect(parsed.config?.profileSnapshot).toEqual(snapshot);
  });

  it("round-trips a team snapshot through storage", () => {
    const teamSnapshot = {
      teamId: "team-crew",
      name: "Shipping crew",
      avatarColor: "#4ec4ff",
      teamPrompt: "Work as a coordinated crew.",
    };
    const agent = createManagedAgent({ config: { teamSnapshot } });

    const record = toStoredAgentRecord(agent, { title: "Crew agent" });
    expect(record.config?.teamSnapshot).toEqual(teamSnapshot);

    // Survives the storage zod parse (the on-disk read path).
    const parsed = parseStoredAgentRecord(record);
    expect(parsed.config?.teamSnapshot).toEqual(teamSnapshot);
  });

  it("falls back to config mode when current mode is null and handles null title", () => {
    const agent = createManagedAgent({
      currentModeId: null,
      config: { modeId: "auto" },
      lastUserMessageAt: null,
    });

    const record = toStoredAgentRecord(agent);
    expect(record.title).toBeNull();
    expect(record.lastModeId).toBe("auto");
    expect(record.lastUserMessageAt).toBeNull();
  });

  it("omits config when no serializable fields exist", () => {
    const agent = createManagedAgent({
      config: {
        modeId: undefined,
        model: undefined,
        providerOptions: undefined,
        toolPolicy: undefined,
      },
    });

    const record = toStoredAgentRecord(agent);
    expect(record.config).toBeNull();
  });

  it("propagates lifecycle status for all states", () => {
    for (const status of AGENT_LIFECYCLE_STATUSES) {
      const agent = createManagedAgent({ lifecycle: status });
      const record = toStoredAgentRecord(agent);
      expect(record.lastStatus).toBe(status);
    }
  });
});

describe("toAgentPayload", () => {
  it("serializes dates, clones arrays, and hides session", () => {
    const permissionA = createPermission({ id: "perm-a" });
    const permissionB = createPermission({
      id: "perm-b",
      provider: "codex",
      metadata: { requestedAt: new Date("2025-02-02T00:00:00.000Z"), extra: { flag: true } },
    });
    const pending = new Map([
      [permissionA.id, permissionA],
      [permissionB.id, permissionB],
    ]);
    const agent = createManagedAgent({
      pendingPermissions: pending,
      lastUsage: { inputTokens: 10, outputTokens: 20 },
      lastError: "boom",
    });

    const payload = toAgentPayload(agent, { title: "UI Payload" });

    expect(payload.createdAt).toBe(agent.createdAt.toISOString());
    expect(payload.updatedAt).toBe(agent.updatedAt.toISOString());
    expect(payload.lastUserMessageAt).toBe(agent.lastUserMessageAt?.toISOString());
    expect(payload.title).toBe("UI Payload");
    expect(payload.model).toBe(agent.config.model);
    expect(payload.thinkingOptionId).toBeNull();
    expect(payload.pendingPermissions.map((item) => item.id)).toEqual(["perm-a", "perm-b"]);
    expect(payload.pendingPermissions[0]).not.toBe(permissionA);
    expect(payload.pendingPermissions[0].input).toEqual({ command: "ls" });
    expect(payload.pendingPermissions[1].metadata).toEqual({
      requestedAt: "2025-02-02T00:00:00.000Z",
      extra: { flag: true },
    });
    expect(payload.runtimeInfo).toEqual(agent.runtimeInfo);
    expect(payload.runtimeInfo).not.toBe(agent.runtimeInfo);
    expect(payload.availableModes).not.toBe(agent.availableModes);
    expect(payload.availableModes).toEqual(agent.availableModes);
    expect(payload.capabilities).not.toBe(agent.capabilities);
    expect(payload.capabilities).toEqual(agent.capabilities);
    expect(payload.lastUsage).toEqual(agent.lastUsage);
    expect(payload.lastUsage).not.toBe(agent.lastUsage);
    expect(payload.lastError).toBe("boom");
    expect((payload as unknown as { session?: unknown }).session).toBeUndefined();

    payload.availableModes[0].label = "Changed";
    expect(agent.availableModes[0].label).toBe("Planning");
    payload.capabilities.supportsStreaming = false;
    expect(agent.capabilities.supportsStreaming).toBe(true);
    payload.pendingPermissions[0].title = "Mutated title";
    expect(permissionA.title).toBe("Run command");
  });

  it("omits usage when any numeric usage field is NaN", () => {
    const fields = [
      "inputTokens",
      "cachedInputTokens",
      "outputTokens",
      "totalCostUsd",
      "contextWindowMaxTokens",
      "contextWindowUsedTokens",
    ] as const;

    for (const field of fields) {
      const agent = createManagedAgent({
        lastUsage: {
          inputTokens: 10,
          cachedInputTokens: 5,
          outputTokens: 20,
          totalCostUsd: 0.5,
          contextWindowMaxTokens: 200_000,
          contextWindowUsedTokens: 100_000,
          [field]: Number.NaN,
        },
      });

      const payload = toAgentPayload(agent);
      expect(payload.lastUsage).toBeUndefined();
    }
  });

  it("produces null title and current mode even without overrides", () => {
    const agent = createManagedAgent({ currentModeId: null, lastUserMessageAt: null });
    const payload = toAgentPayload(agent);
    expect(payload.title).toBeNull();
    expect(payload.currentModeId).toBeNull();
    expect(payload.lastUserMessageAt).toBeNull();
    expect(payload.pendingPermissions).toEqual([]);
  });

  it("propagates lifecycle status for all states", () => {
    for (const status of AGENT_LIFECYCLE_STATUSES) {
      const agent = createManagedAgent({ lifecycle: status });
      const payload = toAgentPayload(agent);
      expect(payload.status).toBe(status);
    }
  });

  it("keeps persistence handles sanitized and detached", () => {
    const agent = createManagedAgent({
      persistence: {
        provider: "codex",
        sessionId: "persist-99",
        nativeHandle: { id: "native" } as unknown,
        metadata: {
          restored: new Date("2025-03-01T00:00:00.000Z"),
          empty: {},
          mcpServers: {
            hub: {
              type: "http",
              headers: { Authorization: "Bearer projection-secret" },
            },
          },
        },
      },
    });
    const payload = toAgentPayload(agent);
    expect(payload.persistence).toEqual({
      provider: "codex",
      sessionId: "persist-99",
      nativeHandle: { id: "native" },
      metadata: { restored: "2025-03-01T00:00:00.000Z" },
    });
    (payload.persistence as AgentPersistenceHandle).sessionId = "mutated";
    expect(agent.persistence!.sessionId).toBe("persist-99");
  });

  it("removes empty persistence metadata after projecting MCP configuration", () => {
    const payload = toAgentPayload(
      createManagedAgent({
        provider: "codex",
        config: { provider: "codex" },
        persistence: {
          provider: "codex",
          sessionId: "persist-mcp-only",
          metadata: { mcpServers: { hub: { type: "http", url: "https://hub.test/mcp" } } },
        },
      }),
    );

    expect(payload.persistence).toEqual({
      provider: "codex",
      sessionId: "persist-mcp-only",
    });
  });

  it("strips MCP metadata from stored wire payloads while preserving private persistence", () => {
    const record = toStoredAgentRecord(
      createManagedAgent({
        provider: "codex",
        config: { provider: "codex" },
        persistence: {
          provider: "codex",
          sessionId: "persist-stored",
          metadata: {
            conversationId: "conversation-stored",
            mcpServers: {
              hub: {
                type: "http",
                headers: { Authorization: "Bearer stored-projection-secret" },
              },
            },
          },
        },
      }),
    );

    const payload = buildStoredAgentPayload(record, ["codex"]);

    expect(record.persistence?.metadata).toEqual({
      conversationId: "conversation-stored",
      mcpServers: {
        hub: {
          type: "http",
          headers: { Authorization: "Bearer stored-projection-secret" },
        },
      },
    });
    expect(payload.persistence?.metadata).toEqual({
      conversationId: "conversation-stored",
    });
  });

  it("omits lastUsage when not available", () => {
    const agent = createManagedAgent({ lastUsage: undefined });
    const payload = toAgentPayload(agent);
    expect(payload).not.toHaveProperty("lastUsage");
  });

  it("preserves context window usage fields when they are valid numbers", () => {
    const agent = createManagedAgent({
      lastUsage: {
        inputTokens: 10,
        contextWindowMaxTokens: 200_000,
        contextWindowUsedTokens: 42_000,
      },
    });

    const payload = toAgentPayload(agent);

    expect(payload.lastUsage).toEqual({
      inputTokens: 10,
      contextWindowMaxTokens: 200_000,
      contextWindowUsedTokens: 42_000,
    });
  });

  it("carries the provider's context categories through verbatim", () => {
    const agent = createManagedAgent({
      lastUsage: {
        contextWindowUsedTokens: 42_000,
        // The category list is open-ended by design: a provider inventing a
        // label the daemon has never heard of must reach the client intact.
        contextCategories: [
          { name: "System prompt", tokens: 1_200 },
          { name: "Memory files", tokens: 800 },
          { name: "Deferred tool schemas", tokens: 9_000, isDeferred: true },
        ],
      },
    });

    const payload = toAgentPayload(agent);

    expect(payload.lastUsage).toEqual({
      contextWindowUsedTokens: 42_000,
      contextCategories: [
        { name: "System prompt", tokens: 1_200 },
        { name: "Memory files", tokens: 800 },
        { name: "Deferred tool schemas", tokens: 9_000, isDeferred: true },
      ],
    });
  });

  it("drops malformed context categories without discarding the good ones", () => {
    const agent = createManagedAgent({
      lastUsage: {
        contextWindowUsedTokens: 42_000,
        contextCategories: [
          { name: "Messages", tokens: 500 },
          { name: "", tokens: 10 },
          { name: "Broken", tokens: Number.NaN },
          { name: "Tools", tokens: "300" as unknown as number },
        ],
      },
    });

    const payload = toAgentPayload(agent);

    expect(payload.lastUsage).toEqual({
      contextWindowUsedTokens: 42_000,
      contextCategories: [{ name: "Messages", tokens: 500 }],
    });
  });

  it("omits lastUsage when context window usage fields are invalid", () => {
    const agent = createManagedAgent({
      lastUsage: {
        inputTokens: 10,
        contextWindowMaxTokens: "200000" as unknown as number,
        contextWindowUsedTokens: NaN,
      },
    });

    const payload = toAgentPayload(agent);

    expect(payload).not.toHaveProperty("lastUsage");
  });

  it("keeps existing lastUsage behavior when context window fields are absent", () => {
    const agent = createManagedAgent({
      lastUsage: {
        inputTokens: 10,
        outputTokens: 20,
        totalCostUsd: 1.25,
      },
    });

    const payload = toAgentPayload(agent);

    expect(payload.lastUsage).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      totalCostUsd: 1.25,
    });
  });

  it("surfaces cumulativeTokens the same way toObservedSubagentPayload does", () => {
    const agent = createManagedAgent({ cumulativeTokens: 4_200 });

    const payload = toAgentPayload(agent);

    expect(payload.cumulativeTokens).toBe(4_200);
  });

  it("omits cumulativeTokens when not tracked", () => {
    const agent = createManagedAgent({ cumulativeTokens: undefined });

    const payload = toAgentPayload(agent);

    expect(payload).not.toHaveProperty("cumulativeTokens");
  });

  it("surfaces a native child's liveness pair, and drops the tool once it stops", () => {
    const running = createManagedAgent({
      lifecycle: "running",
      toolUseCount: 12,
      currentTool: "Edit",
    });

    expect(toAgentPayload(running)).toMatchObject({ toolUseCount: 12, currentTool: "Edit" });

    const idle = createManagedAgent({
      lifecycle: "idle",
      toolUseCount: 12,
      currentTool: "Edit",
    });
    const idlePayload = toAgentPayload(idle);

    expect(idlePayload.toolUseCount).toBe(12);
    expect(idlePayload).not.toHaveProperty("currentTool");
  });

  it("omits the liveness pair when nothing has been tracked", () => {
    const payload = toAgentPayload(createManagedAgent({}));

    expect(payload).not.toHaveProperty("toolUseCount");
    expect(payload).not.toHaveProperty("currentTool");
  });

  it("includes features in the snapshot payload", () => {
    const features = [createFeature()];
    const agent = createManagedAgent({ features });

    const payload = toAgentPayload(agent);

    expect(payload.features).toEqual(features);
  });
});

describe("toRecentProviderSessionDescriptorPayload", () => {
  it("projects provider import rows to provider-opaque public recent sessions", () => {
    const session: ImportableProviderSession & { provider: string } = {
      provider: "codex-custom",
      providerHandleId: "provider-native-handle",
      cwd: "/tmp/project",
      title: "Import me",
      firstPromptPreview: "First prompt with spacing",
      lastPromptPreview: "Second prompt",
      lastActivityAt: new Date("2026-04-30T12:34:56.000Z"),
    };

    const payload = toRecentProviderSessionDescriptorPayload(session, {
      providerLabel: "Custom Codex",
    });

    expect(payload).toEqual({
      providerId: "codex-custom",
      providerLabel: "Custom Codex",
      providerHandleId: "provider-native-handle",
      cwd: "/tmp/project",
      title: "Import me",
      firstPromptPreview: "First prompt with spacing",
      lastPromptPreview: "Second prompt",
      lastActivityAt: "2026-04-30T12:34:56.000Z",
    });
    expect(payload).not.toHaveProperty("providerKind");
    expect(payload).not.toHaveProperty("sessionId");
    expect(payload).not.toHaveProperty("nativeHandle");
  });

  it("preserves null prompt previews", () => {
    const session: ImportableProviderSession & { provider: string } = {
      provider: "claude-custom",
      providerHandleId: "provider-session-id",
      cwd: "/tmp/project",
      title: null,
      lastActivityAt: new Date("2026-04-30T12:34:56.000Z"),
      firstPromptPreview: null,
      lastPromptPreview: null,
    };

    expect(
      toRecentProviderSessionDescriptorPayload(session, {
        providerLabel: "Custom Claude",
      }),
    ).toMatchObject({
      providerId: "claude-custom",
      providerLabel: "Custom Claude",
      providerHandleId: "provider-session-id",
      firstPromptPreview: null,
      lastPromptPreview: null,
    });
  });
});

describe("deriveObservedSubagentTitle", () => {
  it("prefers the stable subAgentType over a progress summary", () => {
    expect(
      deriveObservedSubagentTitle({
        subAgentType: "code-explorer",
        description: "I have now read 14 files and am tracing the auth middleware…",
      }),
    ).toBe("code-explorer");
  });

  it("falls back to the description when no subAgentType is present", () => {
    expect(deriveObservedSubagentTitle({ description: "Explore the auth flow" })).toBe(
      "Explore the auth flow",
    );
  });

  it("uses a generic placeholder when nothing names the subagent", () => {
    expect(deriveObservedSubagentTitle({})).toBe("Subagent");
  });

  it("skips catch-all types like general-purpose in favor of the description", () => {
    expect(
      deriveObservedSubagentTitle({
        subAgentType: "general-purpose",
        description: "Explore the auth flow",
      }),
    ).toBe("Explore the auth flow");
    expect(deriveObservedSubagentTitle({ subAgentType: "General-Purpose" })).toBe("Subagent");
  });

  it("collapses whitespace and hard-caps a wall-of-text label", () => {
    const wall =
      "line one\n  line two   with    lots\tof\nwhitespace that runs on and on and on forever";
    const title = deriveObservedSubagentTitle({ description: wall });
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).not.toContain("\n");
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("observedUpdateHasTitleSource", () => {
  it("is true when a subAgentType or description is present", () => {
    expect(observedUpdateHasTitleSource({ subAgentType: "code-explorer" })).toBe(true);
    expect(observedUpdateHasTitleSource({ description: "do the thing" })).toBe(true);
  });

  it("is false when neither is a usable name source", () => {
    expect(observedUpdateHasTitleSource({})).toBe(false);
    expect(observedUpdateHasTitleSource({ subAgentType: "   ", description: "" })).toBe(false);
  });

  it("does not freeze on a catch-all type alone - a later description should win", () => {
    expect(observedUpdateHasTitleSource({ subAgentType: "general-purpose" })).toBe(false);
    expect(
      observedUpdateHasTitleSource({ subAgentType: "general-purpose", description: "do it" }),
    ).toBe(true);
  });
});

describe("toObservedSubagentPayload", () => {
  it("uses the provided frozen title, ignoring the update's live description", () => {
    const payload = toObservedSubagentPayload({
      id: "parent::sub::task-1",
      parentAgentId: "parent",
      provider: "claude",
      cwd: "/tmp/project",
      createdAt: "2026-05-02T00:00:00.000Z",
      title: "code-explorer",
      update: {
        key: "task-1",
        status: "running",
        subAgentType: "code-explorer",
        description: "an ever-changing progress summary that should not become the label",
      },
    });

    expect(payload.title).toBe("code-explorer");
    expect(payload.attend).toBe("observed");
  });

  it("projects the cumulative token total when provided", () => {
    const payload = toObservedSubagentPayload({
      id: "parent::sub::task-1",
      parentAgentId: "parent",
      provider: "claude",
      cwd: "/tmp/project",
      createdAt: "2026-05-02T00:00:00.000Z",
      title: "code-explorer",
      cumulativeTokens: 12_345,
      update: { key: "task-1", status: "running", subAgentType: "code-explorer" },
    });

    expect(payload.cumulativeTokens).toBe(12_345);
  });

  it("omits the token total when none is provided", () => {
    const payload = toObservedSubagentPayload({
      id: "parent::sub::task-1",
      parentAgentId: "parent",
      provider: "claude",
      cwd: "/tmp/project",
      createdAt: "2026-05-02T00:00:00.000Z",
      title: "code-explorer",
      update: { key: "task-1", status: "running", subAgentType: "code-explorer" },
    });

    expect(payload.cumulativeTokens).toBeUndefined();
  });

  it("projects the subagent's own model and full usage split", () => {
    const payload = toObservedSubagentPayload({
      id: "parent::sub::task-1",
      parentAgentId: "parent",
      provider: "claude",
      cwd: "/tmp/project",
      createdAt: "2026-05-02T00:00:00.000Z",
      title: "code-explorer",
      // A subagent that ran a cheaper model than its parent, with the carried-
      // forward split resolved by the manager.
      model: "claude-haiku-4-5-20251001",
      lastUsage: {
        inputTokens: 4,
        cachedInputTokens: 68_161,
        cacheCreationInputTokens: 726,
        outputTokens: 913,
      },
      update: { key: "task-1", status: "idle", subAgentType: "code-explorer" },
    });

    expect(payload.model).toBe("claude-haiku-4-5-20251001");
    expect(payload.lastUsage).toEqual({
      inputTokens: 4,
      cachedInputTokens: 68_161,
      cacheCreationInputTokens: 726,
      outputTokens: 913,
    });
  });

  it("prefers the carried-forward usage over a scalar-only final update", () => {
    // The final update refreshes only cumulativeTokens (run-state reconcile) and
    // carries no split of its own; the resolved lastUsage must still surface.
    const payload = toObservedSubagentPayload({
      id: "parent::sub::task-1",
      parentAgentId: "parent",
      provider: "claude",
      cwd: "/tmp/project",
      createdAt: "2026-05-02T00:00:00.000Z",
      title: "code-explorer",
      cumulativeTokens: 40_229,
      lastUsage: { inputTokens: 4, outputTokens: 913, cachedInputTokens: 68_161 },
      update: { key: "task-1", status: "idle" },
    });

    expect(payload.lastUsage).toEqual({
      inputTokens: 4,
      outputTokens: 913,
      cachedInputTokens: 68_161,
    });
    expect(payload.cumulativeTokens).toBe(40_229);
  });

  it("projects the liveness pair on a running row", () => {
    const payload = toObservedSubagentPayload({
      id: "parent::sub::task-1",
      parentAgentId: "parent",
      provider: "claude",
      cwd: "/tmp/project",
      createdAt: "2026-05-02T00:00:00.000Z",
      title: "code-explorer",
      toolUseCount: 89,
      currentTool: "Bash",
      update: { key: "task-1", status: "running", subAgentType: "code-explorer" },
    });

    expect(payload.toolUseCount).toBe(89);
    expect(payload.currentTool).toBe("Bash");
  });

  it("keeps the tool count but drops the current tool once the row is terminal", () => {
    // A finished sub-agent still DID 89 tool calls, but it isn't running Bash.
    for (const status of ["idle", "error", "closed"] as const) {
      const payload = toObservedSubagentPayload({
        id: "parent::sub::task-1",
        parentAgentId: "parent",
        provider: "claude",
        cwd: "/tmp/project",
        createdAt: "2026-05-02T00:00:00.000Z",
        title: "code-explorer",
        toolUseCount: 89,
        currentTool: "Bash",
        update: { key: "task-1", status },
      });

      expect(payload.toolUseCount).toBe(89);
      expect(payload).not.toHaveProperty("currentTool");
    }
  });

  it("omits both signals when the provider reports neither", () => {
    const payload = toObservedSubagentPayload({
      id: "parent::sub::task-1",
      parentAgentId: "parent",
      provider: "claude",
      cwd: "/tmp/project",
      createdAt: "2026-05-02T00:00:00.000Z",
      title: "code-explorer",
      update: { key: "task-1", status: "running" },
    });

    expect(payload).not.toHaveProperty("toolUseCount");
    expect(payload).not.toHaveProperty("currentTool");
  });
});
