import pino from "pino";
import { z } from "zod";
import { describe, expect, test } from "vitest";

import { CLIENT_CAPS } from "@otto-code/protocol/client-capabilities";
import {
  type AgentSnapshotPayload,
  AgentSnapshotPayloadSchema,
  AgentTimelineItemPayloadSchema,
  FetchAgentTimelineResponseMessageSchema,
  SessionInboundMessageSchema,
  type SessionOutboundMessage,
} from "@otto-code/protocol/messages";
import { Session, type SessionOptions } from "./session.js";
import { toObservedSubagentPayload } from "./agent/agent-projections.js";
import { createProviderSnapshotManagerStub } from "./test-utils/session-stubs.js";
import type { AgentTimelineRow } from "./agent/agent-manager.js";
import { handleCreateOttoWorktreeRequest } from "./worktree-session.js";

const LegacyTimelineEntryPayloadSchema = z.object({
  provider: z.enum(["claude", "codex", "opencode"]),
  item: AgentTimelineItemPayloadSchema,
  timestamp: z.string(),
  seqStart: z.number().int().nonnegative(),
  seqEnd: z.number().int().nonnegative(),
  sourceSeqRanges: z.array(
    z.object({
      startSeq: z.number().int().nonnegative(),
      endSeq: z.number().int().nonnegative(),
    }),
  ),
  // Copied from v0.1.65-beta.3: no reasoning_merge on the wire yet.
  collapsed: z.array(z.enum(["assistant_merge", "tool_lifecycle"])),
});

const LegacyFetchAgentTimelineResponseMessageSchema = z.object({
  type: z.literal("fetch_agent_timeline_response"),
  payload: FetchAgentTimelineResponseMessageSchema.shape.payload.extend({
    entries: z.array(LegacyTimelineEntryPayloadSchema),
  }),
});

const LegacySubAgentToolCallSchema = z.object({
  type: z.literal("tool_call"),
  callId: z.string(),
  name: z.string(),
  status: z.enum(["running", "completed", "failed", "canceled"]),
  error: z.unknown().nullable(),
  detail: z.object({
    type: z.literal("sub_agent"),
    subAgentType: z.string().optional(),
    description: z.string().optional(),
    log: z.string(),
    // Copied from v0.1.65-beta.3: actions was required even though the UI ignored it.
    actions: z.array(
      z.object({
        index: z.number().int().positive(),
        toolName: z.string(),
        summary: z.string().optional(),
      }),
    ),
  }),
});

const LegacyAgentCapabilityFlagsSchema = z.object({
  supportsStreaming: z.boolean(),
  supportsSessionPersistence: z.boolean(),
  supportsDynamicModes: z.boolean(),
  supportsMcpServers: z.boolean(),
  supportsReasoningStream: z.boolean(),
  supportsToolInvocations: z.boolean(),
});

const LegacyAgentSnapshotPayloadSchema = AgentSnapshotPayloadSchema.extend({
  capabilities: LegacyAgentCapabilityFlagsSchema,
});

interface SessionInternals {
  handleFetchAgentTimelineRequest: (
    message: Extract<
      z.infer<typeof SessionInboundMessageSchema>,
      { type: "fetch_agent_timeline_request" }
    >,
  ) => Promise<void>;
  handleFetchAgent: (agentIdOrIdentifier: string, requestId: string) => Promise<void>;
  handleArchiveAgentRequest: (agentId: string, requestId: string) => Promise<void>;
}

class InMemoryAgentManager {
  constructor(
    private readonly rows: AgentTimelineRow[],
    private readonly observedPayloads: Map<string, AgentSnapshotPayload> = new Map(),
  ) {}

  getAgent(id?: string) {
    // Only the live root agent resolves as a ManagedAgent; observed subagents
    // deliberately have none so the fetch path falls through to the registry.
    if (id !== undefined && id !== "agent-1") {
      return undefined;
    }
    return {
      id: "agent-1",
      provider: "codex",
      cwd: "/tmp/project",
      model: null,
      thinkingOptionId: null,
      effectiveThinkingOptionId: null,
      createdAt: new Date("2026-05-02T00:00:00.000Z"),
      updatedAt: new Date("2026-05-02T00:00:00.000Z"),
      lastUserMessageAt: null,
      lifecycle: "idle",
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
        supportsRewindConversation: false,
        supportsRewindFiles: false,
        supportsRewindBoth: false,
      },
      config: { provider: "codex", cwd: "/tmp/project" },
      currentModeId: null,
      availableModes: [],
      pendingPermissions: new Map(),
      bufferedPermissionResolutions: new Map(),
      inFlightPermissionResponses: new Set(),
      pendingReplacement: false,
      persistence: null,
      historyPrimed: true,
      lastUsage: undefined,
      lastError: undefined,
      attention: { requiresAttention: false, attentionReason: null, attentionTimestamp: null },
      foregroundTurnWaiters: new Set(),
      finalizedForegroundTurnIds: new Set(),
      unsubscribeSession: null,
      session: null,
      activeForegroundTurnId: null,
      labels: {},
    };
  }

  fetchTimeline() {
    return {
      epoch: "epoch-1",
      reset: false,
      staleCursor: false,
      gap: false,
      window: { minSeq: 1, maxSeq: 3, nextSeq: 4 },
      rows: this.rows,
      hasOlder: false,
      hasNewer: false,
    };
  }

  getObservedSubagentPayload(id: string) {
    return this.observedPayloads.get(id) ?? null;
  }

  readonly archivedObservedIds: string[] = [];

  async archiveObservedSubagent(id: string) {
    if (!this.observedPayloads.has(id)) {
      throw new Error(`Observed subagent not found: ${id}`);
    }
    this.archivedObservedIds.push(id);
    return { archivedAt: "2026-05-02T01:23:45.000Z" };
  }

  listAgents() {
    return [];
  }

  subscribe() {
    return () => {};
  }
}

class EmptyAgentStorage {
  async list() {
    return [];
  }

  async get() {
    return null;
  }
}

class EmptyProjectRegistry {
  async list() {
    return [];
  }

  async get() {
    return null;
  }

  async upsert() {}
  async archive() {}
  async remove() {}
  async initialize() {}
  async existsOnDisk() {
    return false;
  }
}

class EmptyWorkspaceRegistry {
  get() {
    return null;
  }

  list() {
    return [];
  }
}

class EmptyDaemonConfigStore {
  get() {
    return {
      mcp: { injectIntoAgents: false },
      providers: {},
    };
  }

  onChange() {
    return () => {};
  }
}

class InMemoryWorktreeWorkflow {
  readonly capturedInputs: unknown[] = [];

  async create(input: unknown) {
    this.capturedInputs.push(input);
    return {} as never;
  }
}

function createSessionForWireCompatTest(options?: {
  clientCapabilities?: Record<string, unknown> | null;
  messages?: SessionOutboundMessage[];
  observedPayloads?: Map<string, AgentSnapshotPayload>;
}): Session {
  const messages = options?.messages ?? [];
  const rows: AgentTimelineRow[] = [
    {
      seq: 1,
      timestamp: "2026-05-02T00:00:00.000Z",
      item: { type: "reasoning", text: "Step " },
    },
    {
      seq: 2,
      timestamp: "2026-05-02T00:00:00.100Z",
      item: { type: "reasoning", text: "by step" },
    },
    {
      seq: 3,
      timestamp: "2026-05-02T00:00:00.200Z",
      item: { type: "assistant_message", text: "done" },
    },
  ];

  const session = new Session({
    clientId: "wire-compat-client",
    clientCapabilities: options?.clientCapabilities ?? null,
    onMessage: (message) => messages.push(message),
    logger: pino({ level: "silent" }),
    downloadTokenStore: {} as SessionOptions["downloadTokenStore"],
    pushTokenStore: {} as SessionOptions["pushTokenStore"],
    ottoHome: "/tmp/otto-home",
    agentManager: new InMemoryAgentManager(
      rows,
      options?.observedPayloads,
    ) as unknown as SessionOptions["agentManager"],
    agentStorage: new EmptyAgentStorage() as unknown as SessionOptions["agentStorage"],
    projectRegistry: new EmptyProjectRegistry() as unknown as SessionOptions["projectRegistry"],
    workspaceRegistry:
      new EmptyWorkspaceRegistry() as unknown as SessionOptions["workspaceRegistry"],
    chatService: {} as SessionOptions["chatService"],
    scheduleService: {} as SessionOptions["scheduleService"],
    loopService: {} as SessionOptions["loopService"],
    checkoutDiffManager: {
      scheduleRefreshForCwd() {},
      onWorkspaceStateMayHaveChanged() {},
    } as unknown as SessionOptions["checkoutDiffManager"],
    github: {
      invalidate() {},
      async searchIssuesAndPrs() {
        return [];
      },
      async createPullRequest() {
        return null;
      },
    } as unknown as SessionOptions["github"],
    workspaceGitService: {
      async getCheckoutDiff() {
        return null;
      },
      async getSnapshot() {
        return null;
      },
      async suggestBranchesForCwd() {
        return [];
      },
      async listStashes() {
        return [];
      },
      peekSnapshot() {
        return null;
      },
      async validateBranchRef() {
        return { ok: false, error: "not found" };
      },
      async hasLocalBranch() {
        return false;
      },
      async resolveRepoRemoteUrl() {
        return null;
      },
      async getWorkspaceGitMetadata() {
        return null;
      },
    } as unknown as SessionOptions["workspaceGitService"],
    daemonConfigStore:
      new EmptyDaemonConfigStore() as unknown as SessionOptions["daemonConfigStore"],
    stt: null,
    tts: null,
    providerSnapshotManager: createProviderSnapshotManagerStub().manager,
    terminalManager: null,
  });

  return session;
}

async function emitTimelineResponse(
  clientCapabilities?: Record<string, unknown> | null,
): Promise<Extract<SessionOutboundMessage, { type: "fetch_agent_timeline_response" }>> {
  const messages: SessionOutboundMessage[] = [];
  const session = createSessionForWireCompatTest({ clientCapabilities, messages });
  const internals = session as unknown as SessionInternals;

  await internals.handleFetchAgentTimelineRequest({
    type: "fetch_agent_timeline_request",
    requestId: "req-timeline",
    agentId: "agent-1",
    projection: "projected",
  });

  const response = messages[0];
  expect(response?.type).toBe("fetch_agent_timeline_response");
  if (!response || response.type !== "fetch_agent_timeline_response") {
    throw new Error("Expected fetch_agent_timeline_response");
  }
  return response;
}

describe("wire compatibility", () => {
  test("assistant timeline message ids are optional on the wire", () => {
    expect(
      AgentTimelineItemPayloadSchema.parse({
        type: "assistant_message",
        text: "old daemon shape",
      }),
    ).toEqual({
      type: "assistant_message",
      text: "old daemon shape",
    });
    expect(
      AgentTimelineItemPayloadSchema.parse({
        type: "assistant_message",
        text: "new daemon shape",
        messageId: "msg-1",
      }),
    ).toEqual({
      type: "assistant_message",
      text: "new daemon shape",
      messageId: "msg-1",
    });
  });

  test("downgrades reasoning_merge for clients that do not declare the capability", async () => {
    const response = await emitTimelineResponse();

    const currentParsed = FetchAgentTimelineResponseMessageSchema.parse(response);
    expect(currentParsed.payload.entries[0]?.collapsed).not.toContain("reasoning_merge");

    const legacyParsed = LegacyFetchAgentTimelineResponseMessageSchema.parse(response);
    expect(legacyParsed.payload.entries[0]?.collapsed).toEqual([]);
  });

  test("preserves reasoning_merge for clients that declare the capability", async () => {
    const response = await emitTimelineResponse({
      [CLIENT_CAPS.reasoningMergeEnum]: true,
    });

    const currentParsed = FetchAgentTimelineResponseMessageSchema.parse(response);
    expect(currentParsed.payload.entries[0]?.collapsed).toContain("reasoning_merge");
  });

  test("sub_agent tool-call payload still parses against the v0.1.65-beta.3 schema", () => {
    const parsed = LegacySubAgentToolCallSchema.parse({
      type: "tool_call",
      callId: "call-sub-agent-1",
      name: "Task",
      status: "completed",
      error: null,
      detail: {
        type: "sub_agent",
        subAgentType: "Explore",
        description: "Inspect repository structure",
        childSessionId: "child-session-1",
        log: "[Read] README.md",
        actions: [],
      },
    });

    expect(parsed.detail.actions).toEqual([]);
  });

  test("old clients parse agent snapshots with rewind capabilities", () => {
    const parsed = LegacyAgentSnapshotPayloadSchema.parse({
      id: "agent-1",
      provider: "claude",
      cwd: "/tmp/project",
      model: null,
      thinkingOptionId: null,
      effectiveThinkingOptionId: null,
      createdAt: "2026-05-23T00:00:00.000Z",
      updatedAt: "2026-05-23T00:00:00.000Z",
      lastUserMessageAt: null,
      status: "idle",
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
        supportsRewindConversation: true,
        supportsRewindFiles: true,
        supportsRewindBoth: true,
      },
      currentModeId: null,
      availableModes: [],
      pendingPermissions: [],
      persistence: null,
      title: null,
      labels: {},
    });

    expect(parsed.capabilities).toEqual({
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    });
  });

  test("new clients parse agent snapshots without rewind capabilities", () => {
    const parsed = AgentSnapshotPayloadSchema.parse({
      id: "agent-1",
      provider: "claude",
      cwd: "/tmp/project",
      model: null,
      thinkingOptionId: null,
      effectiveThinkingOptionId: null,
      createdAt: "2026-05-23T00:00:00.000Z",
      updatedAt: "2026-05-23T00:00:00.000Z",
      lastUserMessageAt: null,
      status: "idle",
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
      currentModeId: null,
      availableModes: [],
      pendingPermissions: [],
      persistence: null,
      title: null,
      labels: {},
    });

    expect(parsed.capabilities.supportsRewindConversation).toBe(false);
    expect(parsed.capabilities.supportsRewindFiles).toBe(false);
    expect(parsed.capabilities.supportsRewindBoth).toBe(false);
  });

  test("legacy worktree request shape normalizes to the same internal input as the new shape", async () => {
    const workflow = new InMemoryWorktreeWorkflow();

    const dependencies = {
      ottoHome: "/tmp/otto-home",
      describeWorkspaceRecord: async () =>
        ({
          id: "ws-1",
          projectId: "proj-1",
          projectDisplayName: "repo",
          projectRootPath: "/tmp/repo",
          projectKind: "directory",
          workspaceKind: "checkout",
          name: "repo",
          cwd: "/tmp/repo",
          status: "ready",
          activityAt: null,
          scripts: [],
        }) as never,
      emit() {},
      sessionLogger: pino({ level: "silent" }),
      createOttoWorktreeWorkflow: workflow.create.bind(workflow),
    };

    const legacyRequest = SessionInboundMessageSchema.parse({
      type: "create_otto_worktree_request",
      requestId: "req-legacy",
      cwd: "/tmp/repo",
      worktreeSlug: "legacy-worktree",
      nameContext: "Investigate flaky test",
      attachments: [
        {
          type: "github_issue",
          mimeType: "application/github-issue",
          number: 55,
          title: "Improve startup error details",
          url: "https://github.com/otto-code-ai/otto-code/issues/55",
        },
      ],
    });

    const newRequest = SessionInboundMessageSchema.parse({
      type: "create_otto_worktree_request",
      requestId: "req-new",
      cwd: "/tmp/repo",
      worktreeSlug: "legacy-worktree",
      firstAgentContext: {
        prompt: "Investigate flaky test",
        attachments: [
          {
            type: "github_issue",
            mimeType: "application/github-issue",
            number: 55,
            title: "Improve startup error details",
            url: "https://github.com/otto-code-ai/otto-code/issues/55",
          },
        ],
      },
    });

    if (legacyRequest.type !== "create_otto_worktree_request") {
      throw new Error("Expected legacy worktree request");
    }
    if (newRequest.type !== "create_otto_worktree_request") {
      throw new Error("Expected new worktree request");
    }

    await handleCreateOttoWorktreeRequest(dependencies, legacyRequest);
    await handleCreateOttoWorktreeRequest(dependencies, newRequest);

    expect(workflow.capturedInputs).toHaveLength(2);
    expect(workflow.capturedInputs[0]).toEqual(workflow.capturedInputs[1]);
    expect(workflow.capturedInputs[0]).toEqual({
      cwd: "/tmp/repo",
      worktreeSlug: "legacy-worktree",
      firstAgentContext: {
        prompt: "Investigate flaky test",
        attachments: [
          {
            type: "github_issue",
            mimeType: "application/github-issue",
            number: 55,
            title: "Improve startup error details",
            url: "https://github.com/otto-code-ai/otto-code/issues/55",
          },
        ],
      },
      refName: undefined,
      action: undefined,
      githubPrNumber: undefined,
      runSetup: false,
      ottoHome: "/tmp/otto-home",
    });
  });

  test("fetch_agent resolves an observed subagent from the registry projection", async () => {
    // An observed subagent (Claude Task / ultracode fan-out) has no live
    // ManagedAgent and is never persisted, so the fetch must fall through to
    // the registry — otherwise a still-visible track row 404s.
    // See docs/agent-lifecycle.md (Item 1).
    const observedId = "agent-1::sub::task-42";
    const observedPayload = toObservedSubagentPayload({
      id: observedId,
      parentAgentId: "agent-1",
      provider: "claude",
      cwd: "/tmp/project",
      createdAt: "2026-05-02T00:00:00.000Z",
      title: "code-explorer",
      update: {
        key: "task-42",
        status: "running",
        subAgentType: "code-explorer",
        description: "Explore the auth flow",
      },
    });

    const messages: SessionOutboundMessage[] = [];
    const session = createSessionForWireCompatTest({
      messages,
      observedPayloads: new Map([[observedId, observedPayload]]),
    });
    const internals = session as unknown as SessionInternals;

    await internals.handleFetchAgent(observedId, "req-observed");

    const response = messages.find((message) => message.type === "fetch_agent_response");
    expect(response?.type).toBe("fetch_agent_response");
    if (!response || response.type !== "fetch_agent_response") {
      throw new Error("Expected fetch_agent_response");
    }
    expect(response.payload.error).toBeNull();
    expect(response.payload.agent?.id).toBe(observedId);
    expect(response.payload.agent?.attend).toBe("observed");
  });

  test("archive_agent resolves an observed subagent through the registry archive path", async () => {
    // Observed subagents have no ManagedAgent and no stored record, so the
    // normal archive command would throw "Agent not found" — the session must
    // route them to AgentManager.archiveObservedSubagent instead. This is the
    // path behind the terminal-row Archive action and "Clear all completed".
    // See docs/agent-lifecycle.md (Items 2 + 6).
    const observedId = "agent-1::sub::task-42";
    const observedPayload = toObservedSubagentPayload({
      id: observedId,
      parentAgentId: "agent-1",
      provider: "claude",
      cwd: "/tmp/project",
      createdAt: "2026-05-02T00:00:00.000Z",
      title: "code-explorer",
      update: { key: "task-42", status: "idle", subAgentType: "code-explorer" },
    });

    const messages: SessionOutboundMessage[] = [];
    const session = createSessionForWireCompatTest({
      messages,
      observedPayloads: new Map([[observedId, observedPayload]]),
    });
    const internals = session as unknown as SessionInternals;

    await internals.handleArchiveAgentRequest(observedId, "req-archive-observed");

    const response = messages.find((message) => message.type === "agent_archived");
    if (!response || response.type !== "agent_archived") {
      throw new Error("Expected agent_archived");
    }
    expect(response.payload.agentId).toBe(observedId);
    // This timestamp can only come from archiveObservedSubagent's stub — proof
    // the observed branch handled it rather than the stored-record command.
    expect(response.payload.archivedAt).toBe("2026-05-02T01:23:45.000Z");
  });

  test("archive_agent still rejects a genuinely-missing agent", async () => {
    const messages: SessionOutboundMessage[] = [];
    const session = createSessionForWireCompatTest({ messages });
    const internals = session as unknown as SessionInternals;

    await expect(
      internals.handleArchiveAgentRequest("agent-1::sub::gone", "req-archive-missing"),
    ).rejects.toThrow("not found");
    expect(messages.find((message) => message.type === "agent_archived")).toBeUndefined();
  });

  test("fetch_agent still reports genuinely-missing agents as not found", async () => {
    const messages: SessionOutboundMessage[] = [];
    const session = createSessionForWireCompatTest({ messages });
    const internals = session as unknown as SessionInternals;

    await internals.handleFetchAgent("agent-1::sub::gone", "req-missing");

    const response = messages.find((message) => message.type === "fetch_agent_response");
    if (!response || response.type !== "fetch_agent_response") {
      throw new Error("Expected fetch_agent_response");
    }
    expect(response.payload.agent).toBeNull();
    expect(response.payload.error).toContain("not found");
  });
});
