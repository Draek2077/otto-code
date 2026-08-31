import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { afterEach, describe, expect, it } from "vitest";
import {
  hasRunningObservedSubagent,
  selectProviderSubagentIdsShadowedByObservedAgents,
  selectProviderSubagentsForParent,
  selectSubagentsForParent,
} from "./select";
import { useProviderSubagentStore } from "./provider-store";
import { useSessionStore, type Agent } from "@/stores/session-store";

const SERVER_ID = "server-1";
const AGENT_TIMESTAMP = new Date("2026-03-08T10:00:00.000Z");
const EMPTY_PENDING_ARCHIVE_IDS = new Set<string>();

const AGENT_DEFAULTS: Agent = {
  serverId: SERVER_ID,
  id: "agent",
  provider: "codex",
  status: "idle",
  createdAt: AGENT_TIMESTAMP,
  updatedAt: AGENT_TIMESTAMP,
  lastUserMessageAt: null,
  lastActivityAt: AGENT_TIMESTAMP,
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
  runtimeInfo: undefined,
  lastUsage: undefined,
  lastError: null,
  title: "Agent",
  cwd: "/tmp/project",
  model: null,
  features: undefined,
  thinkingOptionId: undefined,
  requiresAttention: false,
  attentionReason: null,
  attentionTimestamp: null,
  archivedAt: null,
  parentAgentId: null,
  labels: {},
  projectPlacement: null,
};

function makeAgent(input: Partial<Agent> & Pick<Agent, "id">): Agent {
  return { ...AGENT_DEFAULTS, ...input };
}

function setAgents(agents: Agent[]): void {
  useSessionStore.getState().initializeSession(SERVER_ID, null as unknown as DaemonClient);
  useSessionStore
    .getState()
    .setAgents(SERVER_ID, new Map(agents.map((agent) => [agent.id, agent])));
}

afterEach(() => {
  useSessionStore.getState().clearSession(SERVER_ID);
  useProviderSubagentStore.getState().replaceList(SERVER_ID, "parent", []);
});

describe("selectSubagentsForParent", () => {
  it("hides cached provider children when the host does not support them", () => {
    useProviderSubagentStore.getState().applyUpdate(SERVER_ID, {
      kind: "upsert",
      subagent: {
        id: "provider-child",
        parentAgentId: "parent-a",
        provider: "codex",
        title: "Provider child",
        description: null,
        subtitle: "Codex worker · 4.2k tokens",
        status: "completed",
        createdAt: "2026-03-08T10:01:00.000Z",
        updatedAt: "2026-03-08T10:02:00.000Z",
        toolCallId: "call-1",
      },
    });
    const params = { serverId: SERVER_ID, parentAgentId: "parent-a" };

    expect(
      selectProviderSubagentsForParent(useProviderSubagentStore.getState(), params, false),
    ).toEqual([]);
    expect(
      selectProviderSubagentsForParent(useProviderSubagentStore.getState(), params, true).map(
        (row) => row.id,
      ),
    ).toEqual(["provider-child"]);
    expect(
      selectProviderSubagentsForParent(useProviderSubagentStore.getState(), params, true)[0]
        ?.subtitle,
    ).toBe("Codex worker · 4.2k tokens");
  });

  it("hides locally dismissed provider children while retaining their descriptor", () => {
    const store = useProviderSubagentStore.getState();
    store.applyUpdate(SERVER_ID, {
      kind: "upsert",
      subagent: {
        id: "provider-child",
        parentAgentId: "parent-a",
        provider: "codex",
        title: "Provider child",
        description: null,
        status: "completed",
        createdAt: "2026-03-08T10:01:00.000Z",
        updatedAt: "2026-03-08T10:02:00.000Z",
        toolCallId: "call-1",
      },
    });
    store.hideFromTrack(SERVER_ID, "parent-a", ["provider-child"]);

    expect(
      selectProviderSubagentsForParent(
        useProviderSubagentStore.getState(),
        { serverId: SERVER_ID, parentAgentId: "parent-a" },
        true,
      ),
    ).toEqual([]);
    expect(useProviderSubagentStore.getState().descriptors.size).toBe(1);
  });

  it("returns only non-archived children for the requested parent", () => {
    setAgents([
      makeAgent({ id: "parent-a" }),
      makeAgent({ id: "child-a", parentAgentId: "parent-a" }),
      makeAgent({
        id: "archived-child",
        parentAgentId: "parent-a",
        archivedAt: new Date("2026-03-08T12:00:00.000Z"),
      }),
    ]);

    const rows = selectSubagentsForParent(
      useSessionStore.getState(),
      {
        serverId: SERVER_ID,
        parentAgentId: "parent-a",
      },
      EMPTY_PENDING_ARCHIVE_IDS,
    );

    expect(rows.map((row) => row.id)).toEqual(["child-a"]);
  });

  it("excludes siblings, unrelated agents, and grandchildren", () => {
    setAgents([
      makeAgent({ id: "parent-a" }),
      makeAgent({ id: "parent-b" }),
      makeAgent({ id: "child-a", parentAgentId: "parent-a" }),
      makeAgent({ id: "sibling-b", parentAgentId: "parent-b" }),
      makeAgent({ id: "grandchild-a", parentAgentId: "child-a" }),
      makeAgent({ id: "unrelated" }),
    ]);

    const rows = selectSubagentsForParent(
      useSessionStore.getState(),
      {
        serverId: SERVER_ID,
        parentAgentId: "parent-a",
      },
      EMPTY_PENDING_ARCHIVE_IDS,
    );

    expect(rows.map((row) => row.id)).toEqual(["child-a"]);
  });

  it("shows only direct children for each parent", () => {
    setAgents([
      makeAgent({ id: "parent" }),
      makeAgent({ id: "child", parentAgentId: "parent" }),
      makeAgent({ id: "grandchild", parentAgentId: "child" }),
    ]);

    const parentRows = selectSubagentsForParent(
      useSessionStore.getState(),
      {
        serverId: SERVER_ID,
        parentAgentId: "parent",
      },
      EMPTY_PENDING_ARCHIVE_IDS,
    );
    const childRows = selectSubagentsForParent(
      useSessionStore.getState(),
      {
        serverId: SERVER_ID,
        parentAgentId: "child",
      },
      EMPTY_PENDING_ARCHIVE_IDS,
    );

    expect(parentRows.map((row) => row.id)).toEqual(["child"]);
    expect(childRows.map((row) => row.id)).toEqual(["grandchild"]);
  });

  it("includes nested fan-out reached through observed intermediates only", () => {
    setAgents([
      makeAgent({ id: "chat" }),
      // Observed branch under the chat, with its own observed leaf: the whole
      // tree is this chat's doing, so the leaf shows in the chat's track.
      makeAgent({ id: "chat::sub::branch", parentAgentId: "chat", attend: "observed" }),
      makeAgent({
        id: "chat::sub::leaf",
        parentAgentId: "chat::sub::branch",
        attend: "observed",
      }),
      // Attended child = its own chat with its own track; ITS child stays out.
      makeAgent({ id: "attended-child", parentAgentId: "chat" }),
      makeAgent({ id: "attended-grandchild", parentAgentId: "attended-child" }),
    ]);

    const rows = selectSubagentsForParent(
      useSessionStore.getState(),
      {
        serverId: SERVER_ID,
        parentAgentId: "chat",
      },
      EMPTY_PENDING_ARCHIVE_IDS,
    );

    expect(rows.map((row) => row.id).sort()).toEqual([
      "attended-child",
      "chat::sub::branch",
      "chat::sub::leaf",
    ]);
  });

  it("sorts by createdAt ascending", () => {
    setAgents([
      makeAgent({ id: "parent" }),
      makeAgent({
        id: "third",
        parentAgentId: "parent",
        createdAt: new Date("2026-03-08T10:03:00.000Z"),
      }),
      makeAgent({
        id: "first",
        parentAgentId: "parent",
        createdAt: new Date("2026-03-08T10:01:00.000Z"),
      }),
      makeAgent({
        id: "second",
        parentAgentId: "parent",
        createdAt: new Date("2026-03-08T10:02:00.000Z"),
      }),
    ]);

    const rows = selectSubagentsForParent(
      useSessionStore.getState(),
      {
        serverId: SERVER_ID,
        parentAgentId: "parent",
      },
      EMPTY_PENDING_ARCHIVE_IDS,
    );

    expect(rows.map((row) => row.id)).toEqual(["first", "second", "third"]);
  });

  it("maps only row-rendered fields and does not expose onOpen", () => {
    const createdAt = new Date("2026-03-08T10:01:00.000Z");
    setAgents([
      makeAgent({ id: "parent" }),
      makeAgent({
        id: "child",
        parentAgentId: "parent",
        provider: "claude",
        title: "Review child",
        status: "running",
        requiresAttention: true,
        createdAt,
        attend: "observed",
        model: "should-not-leak",
        cwd: "/private/project",
      }),
    ]);

    const rows = selectSubagentsForParent(
      useSessionStore.getState(),
      {
        serverId: SERVER_ID,
        parentAgentId: "parent",
      },
      EMPTY_PENDING_ARCHIVE_IDS,
    );

    expect(rows).toEqual([
      {
        id: "child",
        provider: "claude",
        title: "Review child",
        description: null,
        subtitle: null,
        status: "running",
        requiresAttention: true,
        createdAt,
        updatedAt: AGENT_TIMESTAMP,
        attend: "observed",
        backgrounded: undefined,
        cumulativeTokens: undefined,
        cumulativeUsage: undefined,
        currentTool: undefined,
        // Rows are a union tagged on `kind`: "otto" for agents Otto owns,
        // "provider" for provider-reported children. See docs/upstream-merges.md.
        kind: "otto",
        personalityName: undefined,
        personalitySpinner: undefined,
        toolUseCount: undefined,
      },
    ]);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      "attend",
      "backgrounded",
      "createdAt",
      "cumulativeTokens",
      "cumulativeUsage",
      "currentTool",
      "description",
      "id",
      "kind",
      "personalityName",
      "personalitySpinner",
      "provider",
      "requiresAttention",
      "status",
      "subtitle",
      "title",
      "toolUseCount",
      "updatedAt",
    ]);
    expect(rows[0]).not.toHaveProperty("onOpen");
    expect(rows[0]).not.toHaveProperty("model");
    expect(rows[0]).not.toHaveProperty("cwd");
  });

  it("moves a child when parentAgentId changes", () => {
    const child = makeAgent({ id: "child", parentAgentId: "parent-a" });
    setAgents([makeAgent({ id: "parent-a" }), makeAgent({ id: "parent-b" }), child]);

    expect(
      selectSubagentsForParent(
        useSessionStore.getState(),
        {
          serverId: SERVER_ID,
          parentAgentId: "parent-a",
        },
        EMPTY_PENDING_ARCHIVE_IDS,
      ).map((row) => row.id),
    ).toEqual(["child"]);
    expect(
      selectSubagentsForParent(
        useSessionStore.getState(),
        {
          serverId: SERVER_ID,
          parentAgentId: "parent-b",
        },
        EMPTY_PENDING_ARCHIVE_IDS,
      ).map((row) => row.id),
    ).toEqual([]);

    setAgents([
      makeAgent({ id: "parent-a" }),
      makeAgent({ id: "parent-b" }),
      { ...child, parentAgentId: "parent-b" },
    ]);

    expect(
      selectSubagentsForParent(
        useSessionStore.getState(),
        {
          serverId: SERVER_ID,
          parentAgentId: "parent-a",
        },
        EMPTY_PENDING_ARCHIVE_IDS,
      ).map((row) => row.id),
    ).toEqual([]);
    expect(
      selectSubagentsForParent(
        useSessionStore.getState(),
        {
          serverId: SERVER_ID,
          parentAgentId: "parent-b",
        },
        EMPTY_PENDING_ARCHIVE_IDS,
      ).map((row) => row.id),
    ).toEqual(["child"]);
  });

  it("excludes children whose archive is pending", () => {
    setAgents([
      makeAgent({ id: "parent" }),
      makeAgent({ id: "child-a", parentAgentId: "parent" }),
      makeAgent({ id: "child-b", parentAgentId: "parent" }),
    ]);

    const rows = selectSubagentsForParent(
      useSessionStore.getState(),
      {
        serverId: SERVER_ID,
        parentAgentId: "parent",
      },
      new Set(["child-b"]),
    );

    expect(rows.map((row) => row.id)).toEqual(["child-a"]);
  });

  it("returns the shared empty array when pending archive hides the last child", () => {
    setAgents([makeAgent({ id: "parent" }), makeAgent({ id: "child", parentAgentId: "parent" })]);

    const rows = selectSubagentsForParent(
      useSessionStore.getState(),
      {
        serverId: SERVER_ID,
        parentAgentId: "parent",
      },
      new Set(["child"]),
    );

    expect(rows).toEqual([]);
    expect(rows).toBe(
      selectSubagentsForParent(
        useSessionStore.getState(),
        {
          serverId: SERVER_ID,
          parentAgentId: "missing-parent",
        },
        EMPTY_PENDING_ARCHIVE_IDS,
      ),
    );
  });
});

describe("provider and observed subagent reconciliation", () => {
  it("keeps one row when Claude reports the same Task through both projections", () => {
    setAgents([
      makeAgent({ id: "parent" }),
      makeAgent({
        id: "parent::sub::task-call-1",
        parentAgentId: "parent",
        provider: "claude",
        attend: "observed",
        title: "Resolve i18n merge conflicts",
      }),
      makeAgent({
        id: "parent::sub::task-call-2",
        parentAgentId: "parent",
        provider: "claude",
        attend: "observed",
        title: "Resolve test and e2e merge conflicts",
      }),
      makeAgent({
        id: "parent::sub::task-call-archived",
        parentAgentId: "parent",
        provider: "claude",
        attend: "observed",
        title: "Archived task",
        archivedAt: new Date("2026-03-08T12:00:00.000Z"),
      }),
    ]);
    useProviderSubagentStore.getState().replaceList(SERVER_ID, "parent", [
      {
        id: "task-call-1",
        parentAgentId: "parent",
        provider: "claude",
        title: "Claude subagent",
        description: null,
        status: "running",
        createdAt: "2026-03-08T10:01:00.000Z",
        updatedAt: "2026-03-08T10:02:00.000Z",
        toolCallId: "task-call-1",
        cwd: null,
      },
      {
        id: "provider-only",
        parentAgentId: "parent",
        provider: "codex",
        title: "Codex child",
        description: null,
        status: "running",
        createdAt: "2026-03-08T10:03:00.000Z",
        updatedAt: "2026-03-08T10:04:00.000Z",
        toolCallId: "provider-only-call",
        cwd: null,
      },
      {
        id: "provider-id-differs",
        parentAgentId: "parent",
        provider: "claude",
        title: "Claude subagent",
        description: null,
        status: "completed",
        createdAt: "2026-03-08T10:05:00.000Z",
        updatedAt: "2026-03-08T10:06:00.000Z",
        toolCallId: "task-call-2",
        cwd: null,
      },
      {
        id: "archived-provider-twin",
        parentAgentId: "parent",
        provider: "claude",
        title: "Claude subagent",
        description: null,
        status: "completed",
        createdAt: "2026-03-08T10:07:00.000Z",
        updatedAt: "2026-03-08T10:08:00.000Z",
        toolCallId: "task-call-archived",
        cwd: null,
      },
    ]);

    const shadowedIds = selectProviderSubagentIdsShadowedByObservedAgents(
      useSessionStore.getState(),
      { serverId: SERVER_ID, parentAgentId: "parent" },
    );
    const providerRows = selectProviderSubagentsForParent(
      useProviderSubagentStore.getState(),
      { serverId: SERVER_ID, parentAgentId: "parent" },
      true,
      new Set(shadowedIds),
    );

    const observedRows = selectSubagentsForParent(
      useSessionStore.getState(),
      { serverId: SERVER_ID, parentAgentId: "parent" },
      EMPTY_PENDING_ARCHIVE_IDS,
    );

    expect(shadowedIds).toEqual(["task-call-1", "task-call-2", "task-call-archived"]);
    expect(providerRows.map((row) => row.id)).toEqual(["provider-only"]);
    expect([...observedRows, ...providerRows].map((row) => row.id)).toEqual([
      "parent::sub::task-call-1",
      "parent::sub::task-call-2",
      "provider-only",
    ]);
  });
});

describe("hasRunningObservedSubagent", () => {
  function agentsOf(agents: Agent[]): ReadonlyMap<string, Agent> {
    setAgents(agents);
    const map = useSessionStore.getState().sessions[SERVER_ID]?.agents;
    if (!map) {
      throw new Error("session not initialized");
    }
    return map;
  }

  it("is true while an observed child of the parent is still running", () => {
    const agents = agentsOf([
      makeAgent({ id: "parent", status: "idle" }),
      makeAgent({
        id: "child",
        parentAgentId: "parent",
        attend: "observed",
        status: "running",
      }),
    ]);

    expect(hasRunningObservedSubagent(agents, "parent")).toBe(true);
  });

  it("is false once every observed child has stopped running", () => {
    const agents = agentsOf([
      makeAgent({ id: "parent", status: "idle" }),
      makeAgent({ id: "child", parentAgentId: "parent", attend: "observed", status: "idle" }),
    ]);

    expect(hasRunningObservedSubagent(agents, "parent")).toBe(false);
  });

  it("ignores archived rows, attended children, and other parents' fan-outs", () => {
    const agents = agentsOf([
      makeAgent({ id: "parent", status: "idle" }),
      makeAgent({
        id: "archived",
        parentAgentId: "parent",
        attend: "observed",
        status: "running",
        archivedAt: AGENT_TIMESTAMP,
      }),
      // An attended child is its own chat with its own cues - the parent is not
      // waiting on it.
      makeAgent({
        id: "attended",
        parentAgentId: "parent",
        attend: "attended",
        status: "running",
      }),
      makeAgent({ id: "other-parent", status: "idle" }),
      makeAgent({
        id: "other-child",
        parentAgentId: "other-parent",
        attend: "observed",
        status: "running",
      }),
    ]);

    expect(hasRunningObservedSubagent(agents, "parent")).toBe(false);
  });

  it("follows a nested observed fan-out", () => {
    const agents = agentsOf([
      makeAgent({ id: "parent", status: "idle" }),
      makeAgent({ id: "child", parentAgentId: "parent", attend: "observed", status: "idle" }),
      makeAgent({
        id: "grandchild",
        parentAgentId: "child",
        attend: "observed",
        status: "running",
      }),
    ]);

    expect(hasRunningObservedSubagent(agents, "parent")).toBe(true);
  });
});
