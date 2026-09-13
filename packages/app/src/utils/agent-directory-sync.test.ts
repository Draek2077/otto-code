import { describe, expect, it } from "vitest";
import type { DaemonClient, FetchAgentsEntry } from "@otto-code/client/internal/daemon-client";
import type { AgentSnapshotPayload } from "@otto-code/protocol/messages";
import { PARENT_AGENT_ID_LABEL } from "@otto-code/protocol/agent-labels";
import type { AgentPermissionRequest } from "@otto-code/protocol/agent-types";
import { useSessionStore } from "@/stores/session-store";
import { normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import { isAgentArchiving, setAgentArchiving } from "@/hooks/use-archive-agent";
import { queryClient } from "@/data/query-client";
import { useClearedSubagentTokensStore } from "@/subagents/cleared-subagent-tokens-store";
import { createUserMessage } from "@/types/stream";
import { AgentStoreProjection } from "@/runtime/directory-sync/internal/agent-store";
import { AgentDirectoryReplica } from "@/runtime/directory-sync/agent-replica";
import {
  createWorkspaceAgentVisibilitySelector,
  workspaceAgentVisibilityEqual,
} from "@/workspace-tabs/agent-visibility";

function createAgentPayload(
  input: Partial<Omit<AgentSnapshotPayload, "labels">> & {
    id: string;
    labels?: Record<string, string>;
  },
): AgentSnapshotPayload {
  return {
    id: input.id,
    provider: input.provider ?? "codex",
    cwd: input.cwd ?? "/repo",
    model: input.model ?? null,
    createdAt: input.createdAt ?? "2026-04-20T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-04-20T00:01:00.000Z",
    lastUserMessageAt: input.lastUserMessageAt ?? null,
    status: input.status ?? "idle",
    capabilities: input.capabilities ?? {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: input.currentModeId ?? null,
    availableModes: input.availableModes ?? [],
    pendingPermissions: input.pendingPermissions ?? [],
    persistence: input.persistence ?? null,
    lastUsage: input.lastUsage,
    title: input.title ?? null,
    labels: input.labels ?? {},
    archivedAt: input.archivedAt ?? null,
  };
}

function createEntry(agent: AgentSnapshotPayload): FetchAgentsEntry {
  return {
    agent,
    project: {
      projectKey: agent.cwd,
      projectName: "repo",
      checkout: {
        cwd: agent.cwd,
        isGit: false,
        currentBranch: null,
        remoteUrl: null,
        worktreeRoot: null,
        isOttoOwnedWorktree: false,
        mainRepoRoot: null,
      },
    },
  };
}

function permission(id: string): AgentPermissionRequest {
  return { id, provider: "codex", name: id, kind: "tool", title: id };
}

function beginPendingSubmission(serverId: string, agentId: string): string {
  const clientMessageId = `client-${agentId}`;
  useSessionStore.getState().beginAgentMessageSubmission(
    serverId,
    agentId,
    createUserMessage({
      clientMessageId,
      text: "Run this",
      timestamp: new Date("2026-07-27T10:00:00.000Z"),
    }),
  );
  return clientMessageId;
}

describe("message submission authority", () => {
  it("normalizes old-daemon status into the shared activity replica", () => {
    const serverId = "server-turn-liveness";
    const agentId = "agent-1";
    const startedAt = "2026-07-27T10:00:01.000Z";
    const store = useSessionStore.getState();
    store.initializeSession(serverId, null);
    const projection = new AgentStoreProjection(serverId);
    for (const [status, updatedAt] of [
      ["idle", startedAt],
      ["running", "2026-07-27T10:00:02.000Z"],
    ] as const) {
      const agent = createAgentPayload({
        id: agentId,
        status,
        updatedAt,
        lastUserMessageAt: startedAt,
      });
      projection.applyDelta({ kind: "upsert", agent, project: createEntry(agent).project });
    }
    expect(store.getSession(serverId)?.agents.get(agentId)?.turn).toEqual({
      phase: "open",
      turnId: null,
      startedAt: new Date(startedAt),
      cancellationRequestId: null,
    });
    const settled = createAgentPayload({
      id: agentId,
      status: "idle",
      updatedAt: "2026-07-27T10:00:03.000Z",
    });
    projection.applyDelta({
      kind: "upsert",
      agent: settled,
      project: createEntry(settled).project,
    });
    expect(store.getSession(serverId)?.agents.get(agentId)?.turn).toEqual({
      phase: "idle",
      cancellationRequestId: null,
    });
    store.clearSession(serverId);
  });
  it("does not settle a submission from an unrelated running transition", () => {
    const serverId = "server-running-is-not-submission-ack";
    const agentId = "agent-1";
    const store = useSessionStore.getState();
    store.initializeSession(serverId, null as unknown as DaemonClient);
    const clientMessageId = beginPendingSubmission(serverId, agentId);
    const agent = createAgentPayload({ id: agentId, status: "running" });
    new AgentStoreProjection(serverId).applyDelta({
      kind: "upsert",
      agent,
      project: createEntry(agent).project,
    });

    expect(useSessionStore.getState().sessions[serverId]?.messageSubmissions.get(agentId)).toEqual([
      {
        clientMessageId,
        providerAcknowledged: false,
        rpcSettled: false,
      },
    ]);
    store.clearSession(serverId);
  });

  it("settles provider acknowledgement only when timeline ingestion reports it", () => {
    const serverId = "server-explicit-provider-ack";
    const agentId = "agent-1";
    const store = useSessionStore.getState();
    store.initializeSession(serverId, null as unknown as DaemonClient);
    const clientMessageId = beginPendingSubmission(serverId, agentId);
    store.setAgentStreamState(serverId, agentId, {
      tail: [
        createUserMessage({
          id: "provider-message",
          messageId: "provider-message",
          clientMessageId,
          text: "Run this",
          timestamp: new Date("2026-07-27T10:00:01.000Z"),
        }),
      ],
      head: [],
    });

    expect(
      useSessionStore.getState().sessions[serverId]?.messageSubmissions.get(agentId)?.[0]
        ?.providerAcknowledged,
    ).toBe(false);

    store.setAgentStreamState(serverId, agentId, {
      acknowledgedClientMessageIds: [clientMessageId],
    });

    expect(
      useSessionStore.getState().sessions[serverId]?.messageSubmissions.get(agentId)?.[0]
        ?.providerAcknowledged,
    ).toBe(true);
    store.clearSession(serverId);
  });
});

describe("repeated directory updates", () => {
  it("keeps viewed content and submissions while notifying a real turn close only once", () => {
    const serverId = "server-identical-rebroadcast";
    const agentId = "agent-1";
    const workspaceId = "workspace-repeat";
    const store = useSessionStore.getState();
    store.initializeSession(serverId, null);
    const stopped: string[] = [];
    const replica = new AgentDirectoryReplica(
      serverId,
      (id) => stopped.push(id),
      () => {},
    );
    const agent: AgentSnapshotPayload = {
      ...createAgentPayload({
        id: agentId,
        status: "running",
        pendingPermissions: [permission("perm-1")],
      }),
      workspaceId,
      activeTurn: { turnId: "turn-1", startedAt: "2026-08-23T00:00:00.000Z" },
    };
    const apply = (value: AgentSnapshotPayload) =>
      replica.applyDelta({ kind: "upsert", agent: value, project: createEntry(value).project });
    apply(agent);
    beginPendingSubmission(serverId, agentId);
    store.setAgentStreamState(serverId, agentId, {
      tail: [
        createUserMessage({
          id: "visible-message",
          text: "Already visible",
          timestamp: new Date(0),
        }),
      ],
    });
    const before = store.getSession(serverId)!;
    const selectVisibility = createWorkspaceAgentVisibilitySelector({ serverId, workspaceId });
    const visibility = selectVisibility(useSessionStore.getState());
    expect(visibility.autoOpenAgentIds.has(agentId)).toBe(true);

    // Directory snapshots are metadata. Replaying them must not reset the
    // independently owned viewed transcript/submission or reopen workspace tabs.
    for (let repeat = 0; repeat < 3; repeat += 1) {
      apply(JSON.parse(JSON.stringify(agent)) as AgentSnapshotPayload);
      const after = store.getSession(serverId)!;
      expect(after.agentStreamTail.get(agentId)).toBe(before.agentStreamTail.get(agentId));
      expect(after.messageSubmissions.get(agentId)).toBe(before.messageSubmissions.get(agentId));
      expect(
        Array.from(after.pendingPermissions.values()).map(({ request }) => request.id),
      ).toEqual(["perm-1"]);
      expect(
        workspaceAgentVisibilityEqual(visibility, selectVisibility(useSessionStore.getState())),
      ).toBe(true);
    }
    expect(stopped).toEqual([]);

    const settled: AgentSnapshotPayload = { ...agent, status: "idle", activeTurn: null };
    apply(settled);
    apply(JSON.parse(JSON.stringify(settled)) as AgentSnapshotPayload);
    expect(stopped).toEqual([agentId]);
    expect(store.getSession(serverId)?.messageSubmissions.get(agentId)).toBe(
      before.messageSubmissions.get(agentId),
    );
    store.clearSession(serverId);
  });

  it("accepts changed title and permission contents even when updatedAt is unchanged", () => {
    const serverId = "server-equal-timestamp-change";
    const store = useSessionStore.getState();
    store.initializeSession(serverId, null);
    const replica = new AgentDirectoryReplica(
      serverId,
      () => {},
      () => {},
    );
    const agent = createAgentPayload({
      id: "agent-1",
      title: "Before",
      pendingPermissions: [permission("perm-1")],
    });
    const apply = (value: AgentSnapshotPayload) =>
      replica.applyDelta({ kind: "upsert", agent: value, project: createEntry(value).project });
    apply(agent);
    const changed: AgentSnapshotPayload = {
      ...agent,
      title: "After",
      pendingPermissions: [{ ...permission("perm-1"), title: "Approve changed operation" }],
    };
    apply(changed);
    expect(replica.snapshot().get(agent.id)?.title).toBe("After");
    expect(
      Array.from(store.getSession(serverId)!.pendingPermissions.values()).map(
        ({ request }) => request.title,
      ),
    ).toEqual(["Approve changed operation"]);
    apply({ ...changed, pendingPermissions: [] });
    expect(store.getSession(serverId)?.pendingPermissions.size).toBe(0);
    store.clearSession(serverId);
  });
});

describe("replaceFetchedAgentDirectory", () => {
  it("preserves timeline initialization while replacing directory state", () => {
    const serverId = "server-initializing";
    const store = useSessionStore.getState();
    store.initializeSession(serverId, null as unknown as DaemonClient);
    store.setInitializingAgents(serverId, new Map([["agent", true]]));

    new AgentStoreProjection(serverId).replaceFetched([
      createEntry(createAgentPayload({ id: "agent" })),
    ]);

    expect(useSessionStore.getState().sessions[serverId]?.initializingAgents.get("agent")).toBe(
      true,
    );
    store.clearSession(serverId);
  });

  it("re-derives parentAgentId every time an agent snapshot is ingested", () => {
    const serverId = "server-1";
    const store = useSessionStore.getState();
    store.initializeSession(serverId, null as unknown as DaemonClient);

    const projection = new AgentStoreProjection(serverId);
    projection.replaceFetched([
      createEntry(
        createAgentPayload({
          id: "child-1",
          labels: { [PARENT_AGENT_ID_LABEL]: "parent-a" },
        }),
      ),
    ]);

    projection.replaceFetched([
      createEntry(
        createAgentPayload({
          id: "child-1",
          labels: { [PARENT_AGENT_ID_LABEL]: "parent-b" },
        }),
      ),
    ]);

    expect(
      useSessionStore.getState().sessions[serverId]?.agents.get("child-1")?.parentAgentId,
    ).toBe("parent-b");

    store.clearSession(serverId);
  });

  it("keeps a locally archived agent hidden when a stale directory refresh arrives", () => {
    const serverId = "server-archive-fetch-race";
    const agentId = "agent-archive-fetch-race";
    const store = useSessionStore.getState();
    store.initializeSession(serverId, null as unknown as DaemonClient);
    const current = normalizeAgentSnapshot(createAgentPayload({ id: agentId }), serverId);
    store.setAgents(
      serverId,
      new Map([[agentId, { ...current, archivedAt: new Date("2026-08-30T00:02:00.000Z") }]]),
    );
    setAgentArchiving({ queryClient, serverId, agentId, isArchiving: true });

    new AgentStoreProjection(serverId).replaceFetched([
      createEntry(
        createAgentPayload({
          id: agentId,
          archivedAt: null,
          updatedAt: "2026-08-30T00:01:00.000Z",
        }),
      ),
    ]);

    expect(store.getSession(serverId)?.agents.get(agentId)?.archivedAt?.toISOString()).toBe(
      "2026-08-30T00:02:00.000Z",
    );
    expect(isAgentArchiving({ queryClient, serverId, agentId })).toBe(true);

    const archived = createAgentPayload({
      id: agentId,
      archivedAt: "2026-08-30T00:04:00.000Z",
      updatedAt: "2026-08-30T00:04:00.000Z",
    });
    new AgentStoreProjection(serverId).applyDelta({
      kind: "upsert",
      agent: archived,
      project: createEntry(archived).project,
    });

    expect(store.getSession(serverId)?.agents.get(agentId)?.archivedAt?.toISOString()).toBe(
      "2026-08-30T00:04:00.000Z",
    );
    expect(isAgentArchiving({ queryClient, serverId, agentId })).toBe(false);

    store.clearSession(serverId);
  });

  it("removes every replica-owned artifact for a removed agent", () => {
    const serverId = "server-removal";
    const agentId = "removed-agent";
    const store = useSessionStore.getState();
    store.initializeSession(serverId, null as unknown as DaemonClient);
    const agent = {
      ...normalizeAgentSnapshot(createAgentPayload({ id: agentId }), serverId),
      projectPlacement: null,
    };
    store.setAgents(serverId, new Map([[agentId, agent]]));
    store.setAgentDetails(serverId, new Map([[agentId, agent]]));
    store.setQueuedMessages(
      serverId,
      new Map([[agentId, [{ id: "queued", text: "next", attachments: [] }]]]),
    );
    store.setAgentTimelineCursor(
      serverId,
      new Map([[agentId, { epoch: "epoch", startSeq: 1, endSeq: 2 }]]),
    );
    store.setPendingPermissions(
      serverId,
      new Map([["permission", { key: "permission", agentId, request: null as never }]]),
    );
    store.setInitializingAgents(serverId, new Map([[agentId, true]]));
    setAgentArchiving({ queryClient, serverId, agentId, isArchiving: true });
    // Side maps a removed agent used to leave behind, one entry per agent for
    // the life of the app.
    store.setAgentPromptSuggestion(serverId, agentId, "Run the tests");
    store.setAgentRateLimit(serverId, agentId, { status: "warning" });
    store.dismissAgentRateLimit(serverId, agentId);
    store.appendSentPrompt(serverId, agentId, "ship it");
    store.markAgentHistorySynchronized(serverId, agentId);
    useClearedSubagentTokensStore.getState().recordCleared({
      serverId,
      parentAgentId: agentId,
      rows: [{ id: "sub-1", cumulativeTokens: 400 }],
    });

    new AgentStoreProjection(serverId).applyDelta({ kind: "remove", agentId });

    const session = useSessionStore.getState().sessions[serverId];
    expect({
      agents: session?.agents.has(agentId),
      details: session?.agentDetails.has(agentId),
      queued: session?.queuedMessages.has(agentId),
      cursor: session?.agentTimelineCursor.has(agentId),
      permissions: session?.pendingPermissions.size,
      initializing: session?.initializingAgents.has(agentId),
      archivePending: isAgentArchiving({ queryClient, serverId, agentId }),
      suggestion: session?.agentPromptSuggestions.has(agentId),
      rateLimit: session?.agentRateLimits.has(agentId),
      dismissedRateLimit: session?.dismissedRateLimits.has(agentId),
      sentPrompts: session?.sentPromptHistory.has(agentId),
      syncGeneration: session?.agentHistorySyncGeneration.has(agentId),
      clearedSubagentTokens: useClearedSubagentTokensStore
        .getState()
        .byParent.has(`${serverId}::${agentId}`),
    }).toEqual({
      agents: false,
      details: false,
      queued: false,
      cursor: false,
      permissions: 0,
      initializing: false,
      archivePending: false,
      suggestion: false,
      rateLimit: false,
      dismissedRateLimit: false,
      sentPrompts: false,
      syncGeneration: false,
      clearedSubagentTokens: false,
    });

    store.clearSession(serverId);
  });

  it("keeps newer metadata while accepting usage-only updates and legacy workspace ownership", () => {
    const serverId = "server-usage";
    const agentId = "usage-agent";
    const store = useSessionStore.getState();
    store.initializeSession(serverId, null as unknown as DaemonClient);
    store.setWorkspaces(
      serverId,
      new Map([
        [
          "legacy-workspace",
          {
            id: "legacy-workspace",
            projectId: "project",
            projectDisplayName: "Project",
            projectRootPath: "/repo",
            workspaceDirectory: "/repo",
            projectKind: "git",
            workspaceKind: "worktree",
            name: "repo",
            status: "done",
            statusEnteredAt: null,
            archivingAt: null,
            diffStat: null,
            scripts: [],
          },
        ],
      ]),
    );
    const current = createAgentPayload({
      id: agentId,
      title: "current",
      status: "running",
      updatedAt: "2026-07-12T11:00:00.000Z",
      lastUsage: { inputTokens: 10, outputTokens: 5 },
      pendingPermissions: [permission("current-permission")],
    });
    const projection = new AgentStoreProjection(serverId);
    projection.applyDelta({
      kind: "upsert",
      agent: current,
      project: createEntry(current).project,
    });
    store.flushAgentLastActivity();
    setAgentArchiving({ queryClient, serverId, agentId, isArchiving: true });

    const staleResult = projection.applyDelta({
      kind: "upsert",
      agent: {
        ...current,
        title: "stale",
        status: "idle",
        updatedAt: "2026-07-12T10:00:00.000Z",
        lastUsage: { inputTokens: 20, outputTokens: 8 },
        pendingPermissions: [permission("stale-permission")],
        archivedAt: "2026-07-12T10:00:00.000Z",
      },
      project: createEntry(current).project,
    });
    store.flushAgentLastActivity();

    const state = useSessionStore.getState();
    const agent = state.sessions[serverId]?.agents.get(agentId);
    expect({
      title: agent?.title,
      status: agent?.status,
      usage: agent?.lastUsage,
      workspaceId: agent?.workspaceId,
      stoppedRunning: staleResult.stoppedRunning,
      permissions: Array.from(state.sessions[serverId]?.pendingPermissions.values() ?? []).map(
        ({ request }) => request.id,
      ),
      archivePending: isAgentArchiving({ queryClient, serverId, agentId }),
      activity: state.agentLastActivity.get(agentId)?.toISOString(),
    }).toEqual({
      title: "current",
      status: "running",
      usage: { inputTokens: 20, outputTokens: 8 },
      workspaceId: "legacy-workspace",
      stoppedRunning: false,
      permissions: ["current-permission"],
      archivePending: true,
      activity: "2026-07-12T11:00:00.000Z",
    });

    store.clearSession(serverId);
  });

  it("suppresses an unarchived live update while the local archive is pending", () => {
    const serverId = "server-archive-upsert-race";
    const agentId = "agent-archive-upsert-race";
    const store = useSessionStore.getState();
    store.initializeSession(serverId, null as unknown as DaemonClient);
    const current = normalizeAgentSnapshot(
      createAgentPayload({ id: agentId, updatedAt: "2026-08-30T00:01:00.000Z" }),
      serverId,
    );
    store.setAgents(
      serverId,
      new Map([[agentId, { ...current, archivedAt: new Date("2026-08-30T00:02:00.000Z") }]]),
    );
    setAgentArchiving({ queryClient, serverId, agentId, isArchiving: true });

    new AgentStoreProjection(serverId).applyDelta({
      kind: "upsert",
      agent: createAgentPayload({
        id: agentId,
        archivedAt: null,
        status: "running",
        updatedAt: "2026-08-30T00:03:00.000Z",
      }),
      project: createEntry(createAgentPayload({ id: agentId })).project,
    });

    expect(store.getSession(serverId)?.agents.get(agentId)?.archivedAt?.toISOString()).toBe(
      "2026-08-30T00:02:00.000Z",
    );
    expect(isAgentArchiving({ queryClient, serverId, agentId })).toBe(true);

    setAgentArchiving({ queryClient, serverId, agentId, isArchiving: false });
    store.clearSession(serverId);
  });
});
