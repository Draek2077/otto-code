/**
 * @vitest-environment jsdom
 */
// Integration test for the STATEFUL adapter side (node registry, backfill,
// live-stream dedup, reconcile-driven lifecycle). Drives the hook through the
// real session store with a fake daemon client and asserts on the exact
// bridge messages the page would receive — this is the layer where "a running
// observed subagent must stay alive until it actually finishes" lives.
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import type { SimulationEvent, VisualizerHostToPageMessage } from "./visualizer-view-types";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

const hoisted = vi.hoisted(() => {
  const state: { client: unknown } = { client: null };
  return {
    state,
    refreshAgentDirectory: vi.fn(async () => undefined),
  };
});

vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ refreshAgentDirectory: hoisted.refreshAgentDirectory }),
  useHostRuntimeClient: () => hoisted.state.client,
}));

import { useSessionStore, type Agent } from "@/stores/session-store";
import { useVisualizerEventAdapter } from "./use-visualizer-event-adapter";

const SERVER_ID = "server-1";
const WORKSPACE_ID = "ws-main";
const BASE_TIME = new Date("2026-07-16T10:00:00.000Z");

type AgentStreamHandler = (message: {
  type: "agent_stream";
  payload: {
    agentId: string;
    event: unknown;
    timestamp: string;
    seq?: number;
    epoch?: string;
  };
}) => void;

interface FakeClient {
  fetchAgentTimeline: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  emitStream: (payload: {
    agentId: string;
    event: unknown;
    timestamp: string;
    seq?: number;
    epoch?: string;
  }) => void;
}

function createFakeClient(): FakeClient {
  const handlers = new Set<AgentStreamHandler>();
  return {
    fetchAgentTimeline: vi.fn(async () => ({
      entries: [],
      epoch: "epoch-1",
      endCursor: { seq: 0 },
      window: { maxSeq: 0 },
    })),
    on: vi.fn((event: string, handler: AgentStreamHandler) => {
      if (event === "agent_stream") {
        handlers.add(handler);
      }
      return () => handlers.delete(handler);
    }),
    emitStream(payload) {
      for (const handler of handlers) {
        handler({ type: "agent_stream", payload });
      }
    },
  };
}

const AGENT_DEFAULTS: Agent = {
  serverId: SERVER_ID,
  id: "agent",
  provider: "claude",
  status: "running",
  createdAt: BASE_TIME,
  updatedAt: BASE_TIME,
  lastUserMessageAt: null,
  lastActivityAt: BASE_TIME,
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
  cwd: "/repo",
  workspaceId: WORKSPACE_ID,
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
  useSessionStore
    .getState()
    .setAgents(SERVER_ID, new Map(agents.map((agent) => [agent.id, agent])));
}

function upsertAgent(agent: Agent): void {
  useSessionStore.getState().setAgents(SERVER_ID, (agents) => {
    const next = new Map(agents);
    next.set(agent.id, agent);
    return next;
  });
}

function collectEvents(messages: VisualizerHostToPageMessage[]): SimulationEvent[] {
  const events: SimulationEvent[] = [];
  for (const message of messages) {
    if (message.type === "agent-event-batch") {
      events.push(...message.events);
    }
  }
  return events;
}

async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
}

describe("useVisualizerEventAdapter (stateful)", () => {
  let messages: VisualizerHostToPageMessage[];
  let client: FakeClient;

  beforeEach(() => {
    vi.useFakeTimers();
    messages = [];
    client = createFakeClient();
    hoisted.state.client = client as unknown as DaemonClient;
    useSessionStore.getState().initializeSession(SERVER_ID, null as unknown as DaemonClient);
  });

  afterEach(() => {
    // Explicit — RTL's automatic cleanup needs a global afterEach, which this
    // suite doesn't register; without it every test's adapter stays mounted
    // and keeps reconciling later tests' store changes.
    cleanup();
    useSessionStore.getState().clearSession(SERVER_ID);
    vi.useRealTimers();
  });

  function renderAdapter() {
    return renderHook(() =>
      useVisualizerEventAdapter({
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
        active: true,
        postMessage: (message) => messages.push(message),
      }),
    );
  }

  it("keeps a running observed subagent alive until it goes idle", async () => {
    setAgents([makeAgent({ id: "root-1", title: "My chat" })]);
    renderAdapter();
    await settle();

    expect(messages.some((m) => m.type === "session-started")).toBe(true);
    const rootSpawn = collectEvents(messages).find((e) => e.type === "agent_spawn");
    expect(rootSpawn?.payload.name).toBe("My chat");

    // The Task subagent materializes mid-run: running, observed, parented.
    upsertAgent(
      makeAgent({
        id: "root-1::sub::toolu_1",
        title: "Explore",
        attend: "observed",
        status: "running",
        parentAgentId: "root-1",
        createdAt: new Date(BASE_TIME.getTime() + 5_000),
        lastActivityAt: new Date(BASE_TIME.getTime() + 5_000),
      }),
    );
    await settle();

    const events = collectEvents(messages);
    const childSpawn = events.find((e) => e.type === "agent_spawn" && e.payload.name === "Explore");
    expect(childSpawn).toBeDefined();
    expect(childSpawn?.payload.parent).toBe("My chat");
    // Load-bearing: a running observed subagent must NOT complete on sight.
    expect(events.filter((e) => e.type === "agent_complete")).toEqual([]);

    // Repeated running updates (task_progress) still must not complete it.
    upsertAgent(
      makeAgent({
        id: "root-1::sub::toolu_1",
        title: "Explore",
        attend: "observed",
        status: "running",
        parentAgentId: "root-1",
        createdAt: new Date(BASE_TIME.getTime() + 5_000),
        lastActivityAt: new Date(BASE_TIME.getTime() + 20_000),
        updatedAt: new Date(BASE_TIME.getTime() + 20_000),
      }),
    );
    await settle();
    expect(collectEvents(messages).filter((e) => e.type === "agent_complete")).toEqual([]);

    // Terminal: idle-observed completes exactly once.
    upsertAgent(
      makeAgent({
        id: "root-1::sub::toolu_1",
        title: "Explore",
        attend: "observed",
        status: "idle",
        parentAgentId: "root-1",
        createdAt: new Date(BASE_TIME.getTime() + 5_000),
        lastActivityAt: new Date(BASE_TIME.getTime() + 60_000),
        updatedAt: new Date(BASE_TIME.getTime() + 60_000),
      }),
    );
    await settle();
    const completes = collectEvents(messages).filter((e) => e.type === "agent_complete");
    expect(completes.map((e) => e.payload.name)).toEqual(["Explore"]);

    // Resurrection: a settled row that revives (background Task handoff keeps
    // emitting task events) re-spawns the node the page already faded out —
    // and completes again when it truly finishes.
    upsertAgent(
      makeAgent({
        id: "root-1::sub::toolu_1",
        title: "Explore",
        attend: "observed",
        status: "running",
        parentAgentId: "root-1",
        createdAt: new Date(BASE_TIME.getTime() + 5_000),
        lastActivityAt: new Date(BASE_TIME.getTime() + 90_000),
        updatedAt: new Date(BASE_TIME.getTime() + 90_000),
      }),
    );
    await settle();
    const spawns = collectEvents(messages).filter(
      (e) => e.type === "agent_spawn" && e.payload.name === "Explore",
    );
    expect(spawns).toHaveLength(2);
    expect(spawns[1]?.payload.parent).toBe("My chat");

    upsertAgent(
      makeAgent({
        id: "root-1::sub::toolu_1",
        title: "Explore",
        attend: "observed",
        status: "idle",
        parentAgentId: "root-1",
        createdAt: new Date(BASE_TIME.getTime() + 5_000),
        lastActivityAt: new Date(BASE_TIME.getTime() + 120_000),
        updatedAt: new Date(BASE_TIME.getTime() + 120_000),
      }),
    );
    await settle();
    expect(
      collectEvents(messages)
        .filter((e) => e.type === "agent_complete")
        .map((e) => e.payload.name),
    ).toEqual(["Explore", "Explore"]);
  });

  it("routes the observed subagent's own live timeline onto its node", async () => {
    setAgents([
      makeAgent({ id: "root-1", title: "My chat" }),
      makeAgent({
        id: "root-1::sub::toolu_1",
        title: "Explore",
        attend: "observed",
        status: "running",
        parentAgentId: "root-1",
      }),
    ]);
    renderAdapter();
    await settle();

    client.emitStream({
      agentId: "root-1::sub::toolu_1",
      event: {
        type: "timeline",
        item: {
          type: "tool_call",
          callId: "call-1",
          name: "Read",
          status: "running",
          detail: { type: "read", filePath: "src/index.ts" },
        },
        provider: "claude",
      },
      timestamp: new Date(BASE_TIME.getTime() + 10_000).toISOString(),
      seq: 5,
      epoch: "epoch-1",
    });
    await settle();

    const toolStart = collectEvents(messages).find((e) => e.type === "tool_call_start");
    expect(toolStart).toBeDefined();
    expect(toolStart?.payload.agent).toBe("Explore");
    expect(toolStart?.payload.tool).toBe("Read");
  });

  it("emits a late subagent_dispatch when the sub_agent detail first appears on a running repeat", async () => {
    setAgents([makeAgent({ id: "root-1", title: "My chat" })]);
    renderAdapter();
    await settle();

    const emitTaskUpdate = (detail: unknown, seq: number) => {
      client.emitStream({
        agentId: "root-1",
        event: {
          type: "timeline",
          item: {
            type: "tool_call",
            callId: "task-call-1",
            name: "Agent",
            status: "running",
            detail,
          },
          provider: "claude",
        },
        timestamp: new Date(BASE_TIME.getTime() + seq * 1_000).toISOString(),
        seq,
        epoch: "epoch-1",
      });
    };

    // First running item: provider hasn't revealed the sub_agent detail yet.
    emitTaskUpdate({ type: "unknown", input: null, output: null }, 5);
    await settle();
    expect(collectEvents(messages).filter((e) => e.type === "subagent_dispatch")).toEqual([]);

    // Later running repeat reveals the sub_agent detail — dispatch fires once.
    const subAgentDetail = { type: "sub_agent", description: "Scan repo files", log: "" };
    emitTaskUpdate(subAgentDetail, 6);
    emitTaskUpdate(subAgentDetail, 7);
    await settle();

    const dispatches = collectEvents(messages).filter((e) => e.type === "subagent_dispatch");
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]?.payload).toMatchObject({
      parent: "My chat",
      child: "Scan repo files",
    });

    // The tool input streams progressively — when subagent_type parses later
    // and changes the derived child label, the dispatch re-emits with the
    // label the observed node will actually be named by.
    emitTaskUpdate(
      { type: "sub_agent", subAgentType: "Explore", description: "Scan repo files", log: "" },
      8,
    );
    await settle();
    const refreshed = collectEvents(messages).filter((e) => e.type === "subagent_dispatch");
    expect(refreshed).toHaveLength(2);
    expect(refreshed[1]?.payload).toMatchObject({ child: "Explore" });
  });

  it("pushes context_update from the agent snapshot's lastUsage without waiting for a turn", async () => {
    setAgents([
      makeAgent({
        id: "root-1",
        title: "My chat",
        lastUsage: { contextWindowUsedTokens: 32_000, contextWindowMaxTokens: 200_000 },
      }),
    ]);
    renderAdapter();
    await settle();

    const first = collectEvents(messages).filter((e) => e.type === "context_update");
    expect(first).toHaveLength(1);
    expect(first[0]?.payload).toMatchObject({
      agent: "My chat",
      tokens: 32_000,
      tokensMax: 200_000,
    });

    // Unchanged usage on later reconciles must not re-emit …
    upsertAgent(
      makeAgent({
        id: "root-1",
        title: "My chat",
        lastUsage: { contextWindowUsedTokens: 32_000, contextWindowMaxTokens: 200_000 },
        updatedAt: new Date(BASE_TIME.getTime() + 5_000),
      }),
    );
    await settle();
    expect(collectEvents(messages).filter((e) => e.type === "context_update")).toHaveLength(1);

    // … but movement does.
    upsertAgent(
      makeAgent({
        id: "root-1",
        title: "My chat",
        lastUsage: { contextWindowUsedTokens: 48_000, contextWindowMaxTokens: 200_000 },
        updatedAt: new Date(BASE_TIME.getTime() + 10_000),
      }),
    );
    await settle();
    const updates = collectEvents(messages).filter((e) => e.type === "context_update");
    expect(updates).toHaveLength(2);
    expect(updates[1]?.payload).toMatchObject({ tokens: 48_000 });
  });

  it("pushes a subagent's cumulativeTokens without a context reading (honest totals)", async () => {
    setAgents([
      makeAgent({ id: "root-1", title: "My chat" }),
      makeAgent({
        id: "root-1::sub::toolu_1",
        title: "Explore",
        attend: "observed",
        status: "running",
        parentAgentId: "root-1",
        cumulativeTokens: 19_000,
      }),
    ]);
    renderAdapter();
    await settle();

    const updates = collectEvents(messages).filter(
      (e) => e.type === "context_update" && e.payload.agent === "Explore",
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]?.payload).toMatchObject({ cumulativeTokens: 19_000 });
    // No context reading — must not carry a tokens field the page would
    // treat as a 0 occupancy.
    expect(updates[0]?.payload).not.toHaveProperty("tokens");

    // The total moving re-emits.
    upsertAgent(
      makeAgent({
        id: "root-1::sub::toolu_1",
        title: "Explore",
        attend: "observed",
        status: "running",
        parentAgentId: "root-1",
        cumulativeTokens: 24_500,
        updatedAt: new Date(BASE_TIME.getTime() + 10_000),
      }),
    );
    await settle();
    const refreshed = collectEvents(messages).filter(
      (e) => e.type === "context_update" && e.payload.agent === "Explore",
    );
    expect(refreshed).toHaveLength(2);
    expect(refreshed[1]?.payload).toMatchObject({ cumulativeTokens: 24_500 });
  });
});
