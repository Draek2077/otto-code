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

  it("prunes a node whose agent has left the authoritative set", async () => {
    // A child fades and a vanished root closes only AFTER hydration settles —
    // during the attach window the set is a partial pre-refresh view.
    setAgents([
      makeAgent({ id: "root-1", title: "My chat" }),
      makeAgent({
        id: "root-1::sub::toolu_1",
        title: "Explore",
        attend: "observed",
        status: "running",
        parentAgentId: "root-1",
        createdAt: new Date(BASE_TIME.getTime() + 5_000),
        lastActivityAt: new Date(BASE_TIME.getTime() + 5_000),
      }),
      makeAgent({
        id: "root-2",
        title: "Other chat",
        createdAt: new Date(BASE_TIME.getTime() + 1_000),
      }),
    ]);
    renderAdapter();
    await settle();
    expect(collectEvents(messages).some((e) => e.type === "agent_spawn")).toBe(true);
    messages.length = 0;

    // The subagent disappears from the store (closed + swept). Its node must
    // fade via agent_complete — not linger as a phantom "still working" node.
    setAgents([
      makeAgent({ id: "root-1", title: "My chat" }),
      makeAgent({
        id: "root-2",
        title: "Other chat",
        createdAt: new Date(BASE_TIME.getTime() + 1_000),
      }),
    ]);
    await settle();
    const completes = collectEvents(messages).filter((e) => e.type === "agent_complete");
    expect(completes.map((e) => e.payload.name)).toEqual(["Explore"]);
    expect(messages.some((m) => m.type === "close-session")).toBe(false);

    // A whole root chat vanishing drives close-session (its session is gone),
    // not agent_complete (which would leave a green "completed" node selected).
    messages.length = 0;
    setAgents([makeAgent({ id: "root-1", title: "My chat" })]);
    await settle();
    const closes = messages.filter((m) => m.type === "close-session");
    expect(closes).toHaveLength(1);
    expect(closes[0]).toMatchObject({ type: "close-session", sessionId: "root-2" });
    expect(collectEvents(messages).filter((e) => e.type === "agent_complete")).toEqual([]);
  });

  it("stamps backfilled history at real relative times from the session start", async () => {
    // The whole point of Part 2: a reopened chat's Execution Timeline + scrubber
    // must show the REAL shape of what happened while away, not a zero-width
    // sliver. Times are anchored at the root's createdAt, so a tool call 6s
    // after the chat started lands at ~6, one 30s after at ~30 — not both at 0.
    const rootCreatedAt = new Date(BASE_TIME.getTime());
    client.fetchAgentTimeline.mockImplementation(async (agentId: string) => {
      if (agentId !== "root-1") {
        return { entries: [], epoch: "epoch-1", endCursor: { seq: 0 }, window: { maxSeq: 0 } };
      }
      return {
        entries: [
          {
            timestamp: new Date(BASE_TIME.getTime() + 6_000).toISOString(),
            item: {
              type: "tool_call",
              callId: "call-early",
              name: "Read",
              status: "completed",
              detail: { type: "read", filePath: "a.ts" },
            },
          },
          {
            timestamp: new Date(BASE_TIME.getTime() + 30_000).toISOString(),
            item: {
              type: "tool_call",
              callId: "call-late",
              name: "Read",
              status: "completed",
              detail: { type: "read", filePath: "b.ts" },
            },
          },
        ],
        epoch: "epoch-1",
        endCursor: { seq: 9 },
        window: { maxSeq: 9 },
      };
    });
    setAgents([
      makeAgent({
        id: "root-1",
        title: "My chat",
        status: "idle",
        createdAt: rootCreatedAt,
        lastActivityAt: new Date(BASE_TIME.getTime() + 30_000),
      }),
    ]);
    renderAdapter();
    await settle();

    const events = collectEvents(messages);
    // The root spawn anchors the session at t=0.
    const spawn = events.find((e) => e.type === "agent_spawn" && e.payload.name === "My chat");
    expect(spawn?.time).toBe(0);
    // Each backfilled tool call keeps its real offset from the session start —
    // proof the history is spread, not clamped to 0.
    const early = events.find((e) => e.type === "tool_call_end" && e.payload.tool === "Read");
    const times = events
      .filter((e) => e.type === "tool_call_end")
      .map((e) => e.time)
      .sort((a, b) => a - b);
    expect(times).toEqual([6, 30]);
    expect(early).toBeDefined();
  });

  it("relabels the node and the session when the root chat title changes", async () => {
    // Spawned with the provisional first-line title (the graph node is keyed on
    // it), then the auto-title writer rewrites it to a terser title.
    setAgents([makeAgent({ id: "root-1", title: "fix the visualizer title bug" })]);
    renderAdapter();
    await settle();

    const rootSpawn = collectEvents(messages).find((e) => e.type === "agent_spawn");
    expect(rootSpawn?.payload.name).toBe("fix the visualizer title bug");

    messages.length = 0;
    upsertAgent(
      makeAgent({
        id: "root-1",
        title: "Visualizer Title Fix",
        lastActivityAt: new Date(BASE_TIME.getTime() + 10_000),
        updatedAt: new Date(BASE_TIME.getTime() + 10_000),
      }),
    );
    await settle();

    // The toolbar dropdown label follows via session-updated…
    const updated = messages.find((m) => m.type === "session-updated");
    expect(updated).toMatchObject({ sessionId: "root-1", label: "Visualizer Title Fix" });

    // …and the graph node relabels in place — agent_rename keys on the STABLE
    // spawn name, carrying the new full title as the display label.
    const rename = collectEvents(messages).find((e) => e.type === "agent_rename");
    expect(rename?.payload).toEqual({
      agent: "fix the visualizer title bug",
      label: "Visualizer Title Fix",
    });

    // Idempotent: a snapshot that doesn't move the title emits neither again.
    messages.length = 0;
    upsertAgent(
      makeAgent({
        id: "root-1",
        title: "Visualizer Title Fix",
        lastActivityAt: new Date(BASE_TIME.getTime() + 20_000),
        updatedAt: new Date(BASE_TIME.getTime() + 20_000),
      }),
    );
    await settle();
    expect(messages.some((m) => m.type === "session-updated")).toBe(false);
    expect(collectEvents(messages).some((e) => e.type === "agent_rename")).toBe(false);
  });

  it("removes the session (not completes it) when the visualized chat is archived", async () => {
    setAgents([makeAgent({ id: "root-1", title: "My chat" })]);
    renderAdapter();
    await settle();
    expect(messages.some((m) => m.type === "session-started")).toBe(true);
    messages.length = 0;

    // Archive the visualized chat.
    upsertAgent(
      makeAgent({
        id: "root-1",
        title: "My chat",
        status: "idle",
        archivedAt: new Date(BASE_TIME.getTime() + 30_000),
        lastActivityAt: new Date(BASE_TIME.getTime() + 30_000),
        updatedAt: new Date(BASE_TIME.getTime() + 30_000),
      }),
    );
    await settle();

    // Removal, not completion: the page is told to drop the session (returning
    // to "Waiting for chat activity"), and NO agent_complete fires (which would
    // fade the node green + play the completion chord while leaving it selected).
    const closes = messages.filter((m) => m.type === "close-session");
    expect(closes).toHaveLength(1);
    expect(closes[0]).toMatchObject({ type: "close-session", sessionId: "root-1" });
    expect(collectEvents(messages).filter((e) => e.type === "agent_complete")).toEqual([]);
    expect(messages.some((m) => m.type === "session-ended")).toBe(false);

    // A further archived snapshot must not re-fire close-session or complete.
    messages.length = 0;
    upsertAgent(
      makeAgent({
        id: "root-1",
        title: "My chat",
        status: "idle",
        archivedAt: new Date(BASE_TIME.getTime() + 30_000),
        lastActivityAt: new Date(BASE_TIME.getTime() + 45_000),
        updatedAt: new Date(BASE_TIME.getTime() + 45_000),
      }),
    );
    await settle();
    expect(messages.filter((m) => m.type === "close-session")).toEqual([]);
    expect(collectEvents(messages).filter((e) => e.type === "agent_complete")).toEqual([]);

    // Un-archiving while attached brings the session back.
    messages.length = 0;
    upsertAgent(
      makeAgent({
        id: "root-1",
        title: "My chat",
        status: "running",
        archivedAt: null,
        lastActivityAt: new Date(BASE_TIME.getTime() + 60_000),
        updatedAt: new Date(BASE_TIME.getTime() + 60_000),
      }),
    );
    await settle();
    expect(messages.some((m) => m.type === "session-started")).toBe(true);
    expect(
      collectEvents(messages).some((e) => e.type === "agent_spawn" && e.payload.name === "My chat"),
    ).toBe(true);
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

  it("coalesces streaming message deltas into one whole-message bubble", async () => {
    setAgents([makeAgent({ id: "root-1", title: "My chat" })]);
    renderAdapter();
    await settle();

    const emitDelta = (text: string, seq: number, messageId = "msg-1") => {
      client.emitStream({
        agentId: "root-1",
        event: {
          type: "timeline",
          item: { type: "assistant_message", text, messageId },
          provider: "claude",
        },
        timestamp: new Date(BASE_TIME.getTime() + seq * 1_000).toISOString(),
        seq,
        epoch: "epoch-1",
      });
    };

    // Token-by-token deltas of ONE message must not each spawn a bubble.
    emitDelta("Hel", 5);
    emitDelta("lo, ", 6);
    emitDelta("world", 7);
    await settle();
    // Nothing settled the message yet → no bubble emitted mid-stream.
    expect(collectEvents(messages).filter((e) => e.type === "message")).toEqual([]);

    // The turn ending settles it into exactly one whole-message event.
    client.emitStream({
      agentId: "root-1",
      event: { type: "turn_completed", provider: "claude" },
      timestamp: new Date(BASE_TIME.getTime() + 8_000).toISOString(),
      seq: 8,
      epoch: "epoch-1",
    });
    await settle();

    const bubbles = collectEvents(messages).filter((e) => e.type === "message");
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]?.payload).toMatchObject({
      agent: "My chat",
      content: "Hello, world",
      role: "assistant",
    });
  });

  it("settles a streaming message when a new message or a tool call intervenes", async () => {
    setAgents([makeAgent({ id: "root-1", title: "My chat" })]);
    renderAdapter();
    await settle();

    const emit = (item: unknown, seq: number) => {
      client.emitStream({
        agentId: "root-1",
        event: { type: "timeline", item, provider: "claude" },
        timestamp: new Date(BASE_TIME.getTime() + seq * 1_000).toISOString(),
        seq,
        epoch: "epoch-1",
      });
    };

    // Reasoning deltas (no messageId) accumulate under the role key…
    emit({ type: "reasoning", text: "Think" }, 5);
    emit({ type: "reasoning", text: "ing…" }, 6);
    // …a different message (assistant) flushes the held reasoning bubble…
    emit({ type: "assistant_message", text: "Answer", messageId: "msg-a" }, 7);
    // …and a tool call flushes the held assistant bubble before its start.
    emit(
      {
        type: "tool_call",
        callId: "call-1",
        name: "Read",
        status: "running",
        detail: { type: "read", filePath: "src/index.ts" },
      },
      8,
    );
    await settle();

    const events = collectEvents(messages);
    const bubbles = events.filter((e) => e.type === "message");
    expect(bubbles.map((e) => e.payload.content)).toEqual(["Thinking…", "Answer"]);
    expect(bubbles.map((e) => e.payload.role)).toEqual(["thinking", "assistant"]);
    // The assistant bubble is emitted before the tool_call_start it preceded.
    const assistantIdx = events.findIndex(
      (e) => e.type === "message" && e.payload.content === "Answer",
    );
    const toolIdx = events.findIndex((e) => e.type === "tool_call_start");
    expect(assistantIdx).toBeGreaterThanOrEqual(0);
    expect(toolIdx).toBeGreaterThan(assistantIdx);
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

  it("tags the initial backfill batch hydrate, and later live batches not", async () => {
    setAgents([makeAgent({ id: "root-1", title: "My chat" })]);
    renderAdapter();
    await settle();

    // Every batch flushed during the one-shot backfill window carries hydrate,
    // so the page settles the replayed history instead of animating it back in.
    const backfillBatches = messages.filter((m) => m.type === "agent-event-batch");
    expect(backfillBatches.length).toBeGreaterThan(0);
    expect(backfillBatches.every((m) => m.type === "agent-event-batch" && m.hydrate === true)).toBe(
      true,
    );

    const beforeLive = messages.length;
    // A live stream event after the window is genuinely-watched activity.
    client.emitStream({
      agentId: "root-1",
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

    const liveBatches = messages.slice(beforeLive).filter((m) => m.type === "agent-event-batch");
    const liveEvents = collectEvents(messages.slice(beforeLive));
    expect(liveEvents.some((e) => e.type === "tool_call_start")).toBe(true);
    // Live batches must animate — never hydrate.
    expect(liveBatches.every((m) => m.type === "agent-event-batch" && !m.hydrate)).toBe(true);
  });

  it("hydrates an agent that only appears via the directory refresh", async () => {
    // The store holds one root at attach; the authoritative directory refresh
    // surfaces a second. Its backfill lands AFTER the initial reconcile — the
    // exact case that used to flip `hydrating` false too early and animate the
    // second chat's whole history on first open. Both must stay hydrate.
    setAgents([makeAgent({ id: "root-1", title: "First chat" })]);
    hoisted.refreshAgentDirectory.mockImplementationOnce(async () => {
      setAgents([
        makeAgent({ id: "root-1", title: "First chat" }),
        makeAgent({ id: "root-2", title: "Second chat" }),
      ]);
    });

    renderAdapter();
    await settle();

    const batches = messages.filter((m) => m.type === "agent-event-batch");
    const spawnNames = new Set(
      collectEvents(messages)
        .filter((e) => e.type === "agent_spawn")
        .map((e) => (e.payload as { name?: string }).name),
    );
    // Both roots spawned — including the refresh-surfaced one.
    expect(spawnNames.size).toBeGreaterThanOrEqual(2);
    // Every batch flushed during hydration is tagged hydrate; nothing animates.
    expect(batches.length).toBeGreaterThan(0);
    expect(batches.every((m) => m.type === "agent-event-batch" && m.hydrate === true)).toBe(true);
  });

  it("re-asserts completion after backfill replays an already-finished agent's history", async () => {
    // Refresh/reattach: the agent is already terminal when first registered,
    // so the reconcile emits agent_complete immediately — but the backfill
    // then appends the whole historical timeline into the same batch, AFTER
    // that complete. The page's tool/message handlers have no completed-guard
    // (only agent_idle/permission do), so without a trailing complete the
    // replayed history revived the node into thinking/tool_calling forever.
    client.fetchAgentTimeline.mockImplementation(async (agentId: string) => {
      if (agentId !== "root-1::sub::toolu_1") {
        return { entries: [], epoch: "epoch-1", endCursor: { seq: 0 }, window: { maxSeq: 0 } };
      }
      return {
        entries: [
          {
            timestamp: new Date(BASE_TIME.getTime() + 6_000).toISOString(),
            item: {
              type: "tool_call",
              callId: "call-1",
              name: "Read",
              status: "completed",
              detail: { type: "read", filePath: "src/index.ts" },
            },
          },
        ],
        epoch: "epoch-1",
        endCursor: { seq: 9 },
        window: { maxSeq: 9 },
      };
    });
    setAgents([
      makeAgent({ id: "root-1", title: "My chat" }),
      makeAgent({
        id: "root-1::sub::toolu_1",
        title: "Explore",
        attend: "observed",
        status: "idle",
        parentAgentId: "root-1",
        createdAt: new Date(BASE_TIME.getTime() + 5_000),
        lastActivityAt: new Date(BASE_TIME.getTime() + 30_000),
      }),
    ]);
    renderAdapter();
    await settle();

    const events = collectEvents(messages);
    const lastToolEventIdx = events.reduce(
      (last, e, i) =>
        (e.type === "tool_call_start" || e.type === "tool_call_end") &&
        e.payload.agent === "Explore"
          ? i
          : last,
      -1,
    );
    const lastCompleteIdx = events.reduce(
      (last, e, i) => (e.type === "agent_complete" && e.payload.name === "Explore" ? i : last),
      -1,
    );
    // The replayed history is present…
    expect(lastToolEventIdx).toBeGreaterThanOrEqual(0);
    // …and the page's LAST word on the finished agent is its completion.
    expect(lastCompleteIdx).toBeGreaterThan(lastToolEventIdx);
  });

  it("settles a reopened idle chat at resting idle after backfill", async () => {
    // The exact "stuck Thinking" regression: a root/attended chat is idle at
    // attach (non-terminal — roots never complete on idle), and its replayed
    // timeline ends on a tool/assistant item because `turn_completed` is a
    // live-only stream event that never lands in the persisted timeline.
    // Without the backfill-tail resting-idle re-assertion, the replay leaves
    // the node pulsing 'thinking' forever and nothing ever settles it.
    client.fetchAgentTimeline.mockImplementation(async (agentId: string) => {
      if (agentId !== "root-1") {
        return { entries: [], epoch: "epoch-1", endCursor: { seq: 0 }, window: { maxSeq: 0 } };
      }
      return {
        entries: [
          {
            timestamp: new Date(BASE_TIME.getTime() + 6_000).toISOString(),
            item: {
              type: "tool_call",
              callId: "call-1",
              name: "Read",
              status: "completed",
              detail: { type: "read", filePath: "src/index.ts" },
            },
          },
        ],
        epoch: "epoch-1",
        endCursor: { seq: 9 },
        window: { maxSeq: 9 },
      };
    });
    setAgents([
      makeAgent({
        id: "root-1",
        title: "My chat",
        status: "idle",
        lastActivityAt: new Date(BASE_TIME.getTime() + 30_000),
      }),
    ]);
    renderAdapter();
    await settle();

    const events = collectEvents(messages);
    const lastToolEventIdx = events.reduce(
      (last, e, i) =>
        (e.type === "tool_call_start" || e.type === "tool_call_end") &&
        e.payload.agent === "My chat"
          ? i
          : last,
      -1,
    );
    const lastRestingIdleIdx = events.reduce(
      (last, e, i) =>
        e.type === "agent_idle" && e.payload.name === "My chat" && e.payload.resting === true
          ? i
          : last,
      -1,
    );
    // The replayed history is present…
    expect(lastToolEventIdx).toBeGreaterThanOrEqual(0);
    // …and the page's LAST word on the resting chat is a resting idle — after
    // the replayed tool activity that would otherwise leave it 'thinking'.
    expect(lastRestingIdleIdx).toBeGreaterThan(lastToolEventIdx);
    // Roots never complete on idle — settling must be an idle, not a completion.
    expect(
      events.filter((e) => e.type === "agent_complete" && e.payload.name === "My chat"),
    ).toEqual([]);
  });

  it("does not resurrect a completed node when its personality colors change", async () => {
    // A live persona-color change re-emits the spawn (re-tint), but a node
    // that already completed must keep its old colors: spawn of an existing
    // name is a reactivate on the page, and the terminal branch can never
    // re-complete it (terminalEmitted stays true) — the node would sit
    // "alive" forever.
    setAgents([
      makeAgent({ id: "root-1", title: "My chat" }),
      makeAgent({
        id: "root-1::sub::toolu_1",
        title: "Explore",
        attend: "observed",
        status: "running",
        parentAgentId: "root-1",
        personalitySpinner: { glowA: "#ff0000", glowB: "#00ff00" },
        createdAt: new Date(BASE_TIME.getTime() + 5_000),
        lastActivityAt: new Date(BASE_TIME.getTime() + 5_000),
      }),
    ]);
    renderAdapter();
    await settle();

    // Sanity: a LIVE persona switch still re-emits the spawn with the new tint.
    messages.length = 0;
    upsertAgent(
      makeAgent({
        id: "root-1::sub::toolu_1",
        title: "Explore",
        attend: "observed",
        status: "running",
        parentAgentId: "root-1",
        personalitySpinner: { glowA: "#0000ff", glowB: "#00ffff" },
        createdAt: new Date(BASE_TIME.getTime() + 5_000),
        lastActivityAt: new Date(BASE_TIME.getTime() + 10_000),
        updatedAt: new Date(BASE_TIME.getTime() + 10_000),
      }),
    );
    await settle();
    const liveRespawns = collectEvents(messages).filter(
      (e) => e.type === "agent_spawn" && e.payload.name === "Explore",
    );
    expect(liveRespawns).toHaveLength(1);
    expect(liveRespawns[0]?.payload).toMatchObject({ colorA: "#0000ff", colorB: "#00ffff" });

    // The subagent finishes (idle-observed is terminal) …
    upsertAgent(
      makeAgent({
        id: "root-1::sub::toolu_1",
        title: "Explore",
        attend: "observed",
        status: "idle",
        parentAgentId: "root-1",
        personalitySpinner: { glowA: "#0000ff", glowB: "#00ffff" },
        createdAt: new Date(BASE_TIME.getTime() + 5_000),
        lastActivityAt: new Date(BASE_TIME.getTime() + 20_000),
        updatedAt: new Date(BASE_TIME.getTime() + 20_000),
      }),
    );
    await settle();
    expect(
      collectEvents(messages)
        .filter((e) => e.type === "agent_complete")
        .map((e) => e.payload.name),
    ).toEqual(["Explore"]);

    // … then its personality colors change (e.g. the personality was edited).
    // The completed node must NOT be re-spawned/resurrected.
    messages.length = 0;
    upsertAgent(
      makeAgent({
        id: "root-1::sub::toolu_1",
        title: "Explore",
        attend: "observed",
        status: "idle",
        parentAgentId: "root-1",
        personalitySpinner: { glowA: "#123456", glowB: "#654321" },
        createdAt: new Date(BASE_TIME.getTime() + 5_000),
        lastActivityAt: new Date(BASE_TIME.getTime() + 30_000),
        updatedAt: new Date(BASE_TIME.getTime() + 30_000),
      }),
    );
    await settle();
    expect(
      collectEvents(messages).filter(
        (e) => e.type === "agent_spawn" && e.payload.name === "Explore",
      ),
    ).toEqual([]);
  });

  it("does not re-spawn an archived root's node when its personality colors change", async () => {
    // Archiving removed the session (close-session); a persona-color re-spawn
    // would target that already-closed session.
    setAgents([
      makeAgent({
        id: "root-1",
        title: "My chat",
        personalitySpinner: { glowA: "#ff0000", glowB: "#00ff00" },
      }),
    ]);
    renderAdapter();
    await settle();

    upsertAgent(
      makeAgent({
        id: "root-1",
        title: "My chat",
        status: "idle",
        personalitySpinner: { glowA: "#ff0000", glowB: "#00ff00" },
        archivedAt: new Date(BASE_TIME.getTime() + 30_000),
        lastActivityAt: new Date(BASE_TIME.getTime() + 30_000),
        updatedAt: new Date(BASE_TIME.getTime() + 30_000),
      }),
    );
    await settle();
    expect(messages.filter((m) => m.type === "close-session")).toHaveLength(1);

    messages.length = 0;
    upsertAgent(
      makeAgent({
        id: "root-1",
        title: "My chat",
        status: "idle",
        personalitySpinner: { glowA: "#123456", glowB: "#654321" },
        archivedAt: new Date(BASE_TIME.getTime() + 30_000),
        lastActivityAt: new Date(BASE_TIME.getTime() + 40_000),
        updatedAt: new Date(BASE_TIME.getTime() + 40_000),
      }),
    );
    await settle();
    expect(collectEvents(messages).filter((e) => e.type === "agent_spawn")).toEqual([]);
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

  // ── Draft sessions (chat tabs with no agent yet) ───────────────────────────
  interface DraftInput {
    draftId: string;
    label: string;
  }
  interface AdapterProps {
    active: boolean;
    draftSessions?: readonly DraftInput[];
  }

  function renderAdapterWithProps(initialProps: AdapterProps) {
    return renderHook(
      (props: AdapterProps) =>
        useVisualizerEventAdapter({
          serverId: SERVER_ID,
          workspaceId: WORKSPACE_ID,
          active: props.active,
          draftSessions: props.draftSessions,
          postMessage: (message) => messages.push(message),
        }),
      { initialProps },
    );
  }

  function startedSession(id: string) {
    return messages.find(
      (m): m is Extract<VisualizerHostToPageMessage, { type: "session-started" }> =>
        m.type === "session-started" && m.session.id === id,
    );
  }

  it("surfaces a draft chat tab as an empty session so it shows in the dropdown", async () => {
    setAgents([]);
    renderAdapterWithProps({ active: true, draftSessions: [{ draftId: "d1", label: "New chat" }] });
    await settle();

    const draft = startedSession("draft:d1");
    expect(draft).toBeDefined();
    // Empty session — a "New chat" label, active, and no events (the page shows
    // "Waiting for chat activity" when this session is selected).
    expect(draft?.session.label).toBe("New chat");
    expect(draft?.session.status).toBe("active");
    expect(collectEvents(messages)).toEqual([]);
  });

  it("closes a draft session when its tab goes away (closed, or became an agent)", async () => {
    setAgents([]);
    const view = renderAdapterWithProps({
      active: true,
      draftSessions: [{ draftId: "d1", label: "New chat" }],
    });
    await settle();
    expect(startedSession("draft:d1")).toBeDefined();
    messages.length = 0;

    // Draft tab retargets to an agent (first message) or is closed → it leaves
    // the draft set, so its empty session is torn down.
    view.rerender({ active: true, draftSessions: [] });
    await settle();
    expect(messages.some((m) => m.type === "close-session" && m.sessionId === "draft:d1")).toBe(
      true,
    );
  });

  it("re-emits draft sessions after an active-transition reset", async () => {
    setAgents([]);
    const view = renderAdapterWithProps({
      active: true,
      draftSessions: [{ draftId: "d1", label: "New chat" }],
    });
    await settle();
    messages.length = 0;

    // Deactivate then reactivate. The main effect re-runs and posts `reset`,
    // which clears the page's whole session list — the draft must be re-emitted
    // against the fresh page (else a hidden-then-shown pane loses its drafts).
    view.rerender({ active: false, draftSessions: [{ draftId: "d1", label: "New chat" }] });
    await settle();
    view.rerender({ active: true, draftSessions: [{ draftId: "d1", label: "New chat" }] });
    await settle();

    expect(messages.some((m) => m.type === "reset")).toBe(true);
    expect(startedSession("draft:d1")).toBeDefined();
  });
});
