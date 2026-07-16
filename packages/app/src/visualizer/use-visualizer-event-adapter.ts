// Stateful Otto -> Visualizer wiring: one visualizer session per root agent
// in the workspace (agents spawned by another tracked agent — observed Task
// children and attended create_agent children alike — render as child nodes
// inside the parent's session, mirroring the subagents track), backfilled
// from the daemon's timeline RPC and
// kept live via `agent_stream`. All actual event construction is delegated
// to the pure functions in visualizer-event-adapter.ts — this file only
// owns node identity (name registry, parent resolution), the backfill/live
// cursor dedup, and batching. See docs/visualizer.md.
import { useEffect, useRef } from "react";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import type { AgentTimelineItem } from "@otto-code/protocol/agent-types";
import type { AgentStreamEventPayload } from "@otto-code/protocol/messages";
import { getHostRuntimeStore, useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore, type Agent } from "@/stores/session-store";
import {
  buildAgentCompleteEvent,
  buildContextUpdateEvent,
  buildModelDetectedEvent,
  buildObservedSubagentSpawnEvent,
  buildRootAgentSpawnEvent,
  buildSubagentDispatchEvent,
  isVisualizerAgentTerminal,
  resolveAgentNodeName,
  resolveSubAgentChildLabel,
  streamEventToSimulationEvents,
  timelineItemToSimulationEvents,
  truncateSessionLabel,
  type AgentNodeContext,
} from "@/visualizer/visualizer-event-adapter";
import type {
  SimulationEvent,
  VisualizerHostToPageMessage,
} from "@/visualizer/visualizer-view-types";

/** Matches the page's internal UI-update throttle — no point batching faster
 * than the page itself redraws. */
const LIVE_FLUSH_INTERVAL_MS = 200;
/** Backstop against a parent-id cycle in corrupt/unexpected data; real chains
 * are one level deep today (root -> observed subagent). */
const MAX_PARENT_WALK_DEPTH = 8;

interface LiveEnvelope {
  event: AgentStreamEventPayload;
  time: number;
  seq?: number;
  epoch?: string;
}

interface TrackedNode {
  sessionId: string;
  name: string;
  isRoot: boolean;
  lastModel: string | null;
  lastTitle: string | null;
  terminalEmitted: boolean;
  /** Null while the initial backfill fetch is in flight; live envelopes are
   * buffered (not dropped) until it resolves. */
  cursor: { epoch: string; seq: number } | null;
  bufferedLive: LiveEnvelope[];
  /** callIds whose tool_call_start has been sent to the page. The daemon's
   * stream coalescer collapses running -> terminal within its flush window
   * into a single terminal item (live and persisted), and the page silently
   * drops a tool_call_end with no running match — so a terminal item for an
   * unseen callId gets its start synthesized. */
  startedToolCallIds: Set<string>;
  /** Last dispatched child label per sub_agent callId. Providers may reveal
   * (or refine) the sub_agent detail across LATER running updates of the same
   * callId — the tool input streams progressively, so the first running item
   * can carry `description` before `subagent_type` has parsed, deriving a
   * different child label than the final one the observed node is named by.
   * A dispatch is (re-)emitted whenever the derived label changes; the page
   * keys the particle's edge by child name, so only a label-accurate dispatch
   * ever renders. */
  subAgentDispatchLabels: Map<string, string>;
  /** Last context-window reading pushed to the page, so reconcile only emits
   * a context_update when the agent snapshot's usage actually moved. */
  lastContextTokens: number | null;
  /** Last lifetime token total pushed to the page (feeds the page's honest
   * token/cost sums — subagents have this even when they carry no context
   * usage reading). */
  lastCumulativeTokens: number | null;
}

interface AdapterState {
  nodes: Map<string, TrackedNode>;
  /** Names already assigned within a session, for collision suffixing. */
  sessionNames: Map<string, Set<string>>;
  pending: SimulationEvent[];
  pendingSessionMessages: VisualizerHostToPageMessage[];
  /** Agent ids that just got a node and still need their timeline fetched. */
  pendingBackfill: string[];
  /** Wall-clock anchor for event times. The page's simulation clock runs in
   * SECONDS from ~0 (rAF dt accumulation); every constant it ages against
   * (TOOL_MAX_RUNNING_S etc.) and its m:ss time readout assume that scale.
   * Feeding raw epoch-ms slammed the sim clock ~1.7e12 ahead on every event,
   * so two events 200ms apart were "200 seconds" apart — running tools blew
   * past their max-running age between batches and faded while still active.
   * Events are stamped `(ms - epochMs) / 1000`, clamped at 0 (backfilled
   * history predates activation; the page clamps stale times to "now"
   * anyway). Session-message fields (startTime/lastActivityTime) stay
   * epoch-ms — the page mixes those with its own Date.now(). */
  epochMs: number;
}

function createAdapterState(): AdapterState {
  return {
    nodes: new Map(),
    sessionNames: new Map(),
    pending: [],
    pendingSessionMessages: [],
    pendingBackfill: [],
    epochMs: Date.now(),
  };
}

/** Epoch-ms -> page simulation seconds (see {@link AdapterState.epochMs}). */
function toSimTime(state: AdapterState, epochMs: number): number {
  if (!Number.isFinite(epochMs)) {
    return 0;
  }
  return Math.max(0, (epochMs - state.epochMs) / 1000);
}

function nodeCtx(node: TrackedNode): AgentNodeContext {
  return { name: node.name, sessionId: node.sessionId };
}

/** Walks up `parentAgentId` (observed AND attended children — the visualizer
 * mirrors the subagents track, which lists both under the parent) to find the
 * root agent the SimulationEvent sessionId is keyed on. The walk stops at the
 * topmost agent still present in the workspace set — an agent whose parent
 * isn't tracked here is its own root. */
function resolveRootAgentId(agentId: string, agentsById: ReadonlyMap<string, Agent>): string {
  let currentId = agentId;
  for (let depth = 0; depth < MAX_PARENT_WALK_DEPTH; depth += 1) {
    const current = agentsById.get(currentId);
    if (!current?.parentAgentId || !agentsById.has(current.parentAgentId)) {
      return currentId;
    }
    currentId = current.parentAgentId;
  }
  return currentId;
}

/** Ensures a tracked node exists for `agentId`, recursively registering any
 * observed-subagent ancestor first so `parent`/`sessionId` resolve correctly.
 * Returns undefined only if `agentId` isn't in `agentsById` at all. */
function ensureNode(
  state: AdapterState,
  agentId: string,
  agentsById: ReadonlyMap<string, Agent>,
): TrackedNode | undefined {
  const existing = state.nodes.get(agentId);
  if (existing) {
    return existing;
  }
  const agent = agentsById.get(agentId);
  if (!agent) {
    return undefined;
  }

  const parentPresent = Boolean(agent.parentAgentId && agentsById.has(agent.parentAgentId));
  // An observed subagent is never a chat of its own — if its parent isn't in
  // the set yet (snapshot ordering), don't register it as an orphan session;
  // the next reconcile picks it up once the parent is tracked.
  if (!parentPresent && agent.attend === "observed" && agent.parentAgentId) {
    return undefined;
  }
  // Any agent spawned by another tracked agent (observed Task children AND
  // attended create_agent children) renders as a child node in its parent's
  // session, mirroring the subagents track — not as a separate top-level chat.
  const isRoot = !parentPresent;
  const rootId = isRoot ? agentId : resolveRootAgentId(agentId, agentsById);
  const time = agent.createdAt.getTime();

  const usedNames = state.sessionNames.get(rootId) ?? new Set<string>();
  state.sessionNames.set(rootId, usedNames);
  const name = resolveAgentNodeName({ agentId, title: agent.title, usedNames });
  usedNames.add(name);

  const node: TrackedNode = {
    sessionId: rootId,
    name,
    isRoot,
    lastModel: agent.model,
    lastTitle: agent.title,
    terminalEmitted: false,
    cursor: null,
    bufferedLive: [],
    startedToolCallIds: new Set(),
    subAgentDispatchLabels: new Map(),
    lastContextTokens: null,
    lastCumulativeTokens: null,
  };
  state.nodes.set(agentId, node);
  state.pendingBackfill.push(agentId);

  if (isRoot) {
    state.pendingSessionMessages.push({
      type: "session-started",
      session: {
        id: rootId,
        label: truncateSessionLabel(agent.title ?? name),
        status: "active",
        startTime: time,
        lastActivityTime: agent.lastActivityAt.getTime(),
      },
    });
    state.pending.push(
      buildRootAgentSpawnEvent({
        ctx: nodeCtx(node),
        model: agent.model,
        provider: agent.provider,
        time: toSimTime(state, time),
      }),
    );
  } else {
    const parentId = agent.parentAgentId as string;
    const parentNode = ensureNode(state, parentId, agentsById);
    state.pending.push(
      buildObservedSubagentSpawnEvent({
        ctx: nodeCtx(node),
        parentName: parentNode?.name ?? parentId,
        task: agent.title,
        time: toSimTime(state, time),
      }),
    );
  }
  return node;
}

/** Diffs the workspace's current agent snapshots against tracked nodes:
 * registers newly-seen agents (spawn + queue a backfill) and emits
 * model/rename/terminal transitions for ones already tracked. */
function reconcileAgents(state: AdapterState, agents: readonly Agent[]): void {
  if (agents.length === 0) {
    return;
  }
  const agentsById = new Map(agents.map((agent) => [agent.id, agent] as const));
  // Oldest first so a root's node exists before we'd otherwise need to
  // synthesize it while registering a child out of order.
  const sorted = [...agents].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  for (const agent of sorted) {
    let node = state.nodes.get(agent.id);
    if (!node) {
      node = ensureNode(state, agent.id, agentsById);
      if (!node) {
        continue;
      }
    } else {
      const time = toSimTime(state, agent.lastActivityAt.getTime());
      if (agent.model && agent.model !== node.lastModel) {
        node.lastModel = agent.model;
        state.pending.push(
          buildModelDetectedEvent({ ctx: nodeCtx(node), model: agent.model, time }),
        );
      }
      if (node.isRoot && agent.title && agent.title !== node.lastTitle) {
        node.lastTitle = agent.title;
        state.pendingSessionMessages.push({
          type: "session-updated",
          sessionId: node.sessionId,
          label: truncateSessionLabel(agent.title),
        });
      }
    }

    reconcileNodeTokens(state, node, agent);
    reconcileNodeLifecycle(state, node, agent);
  }
}

/** Context ring + honest totals: the page draws the main node's context
 * -window ring from context_update `tokens`, and sums each node's
 * `cumulativeTokens` (lifetime total, Otto vendor patch) for the top-bar
 * token/cost readout — context occupancy alone omitted every subagent's
 * spend. The live source (turn_completed usage) fires once per turn AND
 * never on backfill, so push from the snapshot whenever either reading moves
 * (subagents typically carry only cumulativeTokens). */
function reconcileNodeTokens(state: AdapterState, node: TrackedNode, agent: Agent): void {
  const contextTokens = agent.lastUsage?.contextWindowUsedTokens ?? null;
  const cumulativeTokens = agent.cumulativeTokens ?? null;
  const contextMoved = contextTokens != null && contextTokens !== node.lastContextTokens;
  const cumulativeMoved =
    cumulativeTokens != null && cumulativeTokens !== node.lastCumulativeTokens;
  if (!contextMoved && !cumulativeMoved) {
    return;
  }
  node.lastContextTokens = contextTokens ?? node.lastContextTokens;
  node.lastCumulativeTokens = cumulativeTokens ?? node.lastCumulativeTokens;
  const contextEvent = buildContextUpdateEvent({
    ctx: nodeCtx(node),
    ...(agent.lastUsage ? { usage: agent.lastUsage } : {}),
    ...(cumulativeTokens != null ? { cumulativeTokens } : {}),
    time: toSimTime(state, agent.lastActivityAt.getTime()),
  });
  if (contextEvent) {
    state.pending.push(contextEvent);
  }
}

/** Emits the terminal transition (complete/fade) — or, when a settled row
 * revives, the resurrecting re-spawn. Terminal detection runs for
 * freshly-registered nodes too, so a backfill that first sees an already
 * -finished (idle) observed subagent still completes it instead of leaving
 * the node stuck active forever. */
function reconcileNodeLifecycle(state: AdapterState, node: TrackedNode, agent: Agent): void {
  const isTerminal = isVisualizerAgentTerminal({
    status: agent.status,
    attend: agent.attend,
    archived: Boolean(agent.archivedAt),
    requiresAttention: Boolean(agent.requiresAttention),
  });
  const time = toSimTime(state, agent.lastActivityAt.getTime());
  if (isTerminal && !node.terminalEmitted) {
    node.terminalEmitted = true;
    state.pending.push(buildAgentCompleteEvent({ ctx: nodeCtx(node), time }));
    if (node.isRoot) {
      state.pendingSessionMessages.push({ type: "session-ended", sessionId: node.sessionId });
    }
    return;
  }
  if (!isTerminal && node.terminalEmitted) {
    // Resurrection: an observed row can revive after settling — e.g. a Task
    // whose tool_result was really a "continuing in background" handoff
    // keeps emitting task events afterward. The page may have already faded
    // and deleted the node; a fresh agent_spawn recreates it (or reactivates
    // it mid-fade — spawn of an existing name is a reactivate).
    node.terminalEmitted = false;
    if (node.isRoot) {
      state.pending.push(
        buildRootAgentSpawnEvent({
          ctx: nodeCtx(node),
          model: agent.model,
          provider: agent.provider,
          time,
        }),
      );
      return;
    }
    const parentNode = agent.parentAgentId ? state.nodes.get(agent.parentAgentId) : undefined;
    state.pending.push(
      buildObservedSubagentSpawnEvent({
        ctx: nodeCtx(node),
        parentName: parentNode?.name ?? agent.parentAgentId ?? node.sessionId,
        task: agent.title,
        time,
      }),
    );
  }
}

/** Maps a timeline item through the pure adapter while maintaining the
 * node's sent-start callId bookkeeping (see `startedToolCallIds`). */
function trackedTimelineItemEvents(node: TrackedNode, item: AgentTimelineItem, time: number) {
  let synthesizeToolCallStart = false;
  if (item.type === "tool_call") {
    const alreadyStarted = node.startedToolCallIds.has(item.callId);
    const isSubAgent = item.detail.type === "sub_agent";
    // A long-running tool call (Task/sub_agent especially) streams repeated
    // in-place updates of the SAME running item as its output grows. The page
    // treats every tool_call_start as a fresh node+dispatch — re-emitting made
    // each progress update spark a new outward-firing task node. One start per
    // callId; later running updates carry nothing the graph shows anyway —
    // EXCEPT a sub_agent detail appearing for the first time (some providers
    // only enrich the running item later): that still owes its dispatch spark.
    if (item.status === "running" && alreadyStarted) {
      if (isSubAgent && item.detail.type === "sub_agent") {
        const label = resolveSubAgentChildLabel(item.detail);
        if (node.subAgentDispatchLabels.get(item.callId) !== label) {
          node.subAgentDispatchLabels.set(item.callId, label);
          return [buildSubagentDispatchEvent({ ctx: nodeCtx(node), detail: item.detail, time })];
        }
      }
      return [];
    }
    synthesizeToolCallStart = item.status !== "running" && !alreadyStarted;
    node.startedToolCallIds.add(item.callId);
    // A start emitted with a sub_agent detail (fresh running item, or a
    // synthesized start for a coalesced terminal) carries its own dispatch.
    if (
      isSubAgent &&
      item.detail.type === "sub_agent" &&
      (item.status === "running" || synthesizeToolCallStart)
    ) {
      node.subAgentDispatchLabels.set(item.callId, resolveSubAgentChildLabel(item.detail));
    }
  }
  return timelineItemToSimulationEvents({
    ctx: nodeCtx(node),
    item,
    time,
    synthesizeToolCallStart,
  });
}

function applyLiveEnvelope(state: AdapterState, node: TrackedNode, envelope: LiveEnvelope): void {
  if (envelope.event.type === "timeline") {
    if (envelope.seq != null && envelope.epoch != null) {
      if (node.cursor && envelope.epoch === node.cursor.epoch && envelope.seq <= node.cursor.seq) {
        // Already covered by backfill (or a duplicate live delivery) — drop.
        return;
      }
      node.cursor = { epoch: envelope.epoch, seq: envelope.seq };
    }
    state.pending.push(...trackedTimelineItemEvents(node, envelope.event.item, envelope.time));
    return;
  }
  state.pending.push(
    ...streamEventToSimulationEvents({
      ctx: nodeCtx(node),
      event: envelope.event,
      time: envelope.time,
    }),
  );
}

async function backfillAgentTimeline(input: {
  state: AdapterState;
  client: DaemonClient;
  agentId: string;
}): Promise<void> {
  const { state, client, agentId } = input;
  const node = state.nodes.get(agentId);
  if (!node) {
    return;
  }
  try {
    // limit: 0 = "all matching rows" (see FetchAgentTimelineRequestMessageSchema) —
    // a one-shot full replay, matching "replay the agent's existing timeline
    // as one agent-event-batch" in the task doc rather than the chat UI's
    // paged/scroll-driven backfill.
    const response = await client.fetchAgentTimeline(agentId, {
      direction: "tail",
      limit: 0,
      projection: "projected",
    });
    for (const entry of response.entries) {
      const time = toSimTime(state, Date.parse(entry.timestamp));
      state.pending.push(...trackedTimelineItemEvents(node, entry.item, time));
    }
    node.cursor = { epoch: response.epoch, seq: response.endCursor?.seq ?? response.window.maxSeq };
  } catch {
    // Best-effort: an always-accepting cursor lets buffered/future live
    // events through instead of stalling this node forever.
    node.cursor = { epoch: "", seq: 0 };
  }

  const buffered = node.bufferedLive;
  node.bufferedLive = [];
  for (const envelope of buffered) {
    applyLiveEnvelope(state, node, envelope);
  }
}

/** The page auto-selects every `session-started` it receives, so the last one
 * in a batch wins. A replay batch (initial attach, visibility-regain reset)
 * starts sessions in reconcile order — createdAt, an arbitrary artifact — so
 * without reordering the selected chat jumps to the newest-created agent on
 * every reattach. Reorder whole per-session message runs so the most recently
 * ACTIVE session starts last; within-session order is preserved (an `ended`
 * must never precede its own `started`). Batches with fewer than two
 * `session-started` messages pass through untouched. */
function orderSessionMessagesForSelection(
  messages: VisualizerHostToPageMessage[],
): VisualizerHostToPageMessage[] {
  let startedCount = 0;
  for (const message of messages) {
    if (message.type === "session-started") {
      startedCount++;
    }
  }
  if (startedCount < 2) {
    return messages;
  }
  const groups = new Map<string, { activity: number; messages: VisualizerHostToPageMessage[] }>();
  for (const message of messages) {
    let key = "";
    if (message.type === "session-started") {
      key = message.session.id;
    } else if (message.type === "session-updated" || message.type === "session-ended") {
      key = message.sessionId;
    }
    let group = groups.get(key);
    if (!group) {
      group = { activity: Number.NEGATIVE_INFINITY, messages: [] };
      groups.set(key, group);
    }
    group.messages.push(message);
    if (message.type === "session-started") {
      group.activity = message.session.lastActivityTime;
    }
  }
  // Stable sort: groups without a `started` (activity -Infinity) keep their
  // relative order at the front; started sessions ascend by last activity so
  // the most recent lands last (and gets auto-selected).
  return [...groups.values()]
    .sort((left, right) => left.activity - right.activity)
    .flatMap((group) => group.messages);
}

function flush(
  state: AdapterState,
  postMessage: (message: VisualizerHostToPageMessage) => void,
): void {
  for (const message of orderSessionMessagesForSelection(state.pendingSessionMessages)) {
    postMessage(message);
  }
  state.pendingSessionMessages = [];
  if (state.pending.length > 0) {
    const events = state.pending;
    state.pending = [];
    postMessage({ type: "agent-event-batch", events });
  }
}

/** When `agentIdFilter` is set (Runs "Visualize" scoping — see
 * runs-screen.tsx), an agent is kept if it's in the filter directly OR its
 * resolved root (per the same observed-subagent walk `ensureNode` uses) is —
 * so a run's spawned agents keep their parent/child wiring even though the
 * parent itself may not be one of the run's own agent ids. */
function selectWorkspaceAgents(
  serverId: string,
  workspaceId: string,
  agentIdFilter: ReadonlySet<string> | null,
): Agent[] {
  const agents = useSessionStore.getState().sessions[serverId]?.agents;
  if (!agents) {
    return [];
  }
  const inWorkspace: Agent[] = [];
  for (const agent of agents.values()) {
    if (agent.workspaceId === workspaceId) {
      inWorkspace.push(agent);
    }
  }
  if (!agentIdFilter) {
    return inWorkspace;
  }
  const agentsById = new Map(inWorkspace.map((agent) => [agent.id, agent] as const));
  return inWorkspace.filter(
    (agent) =>
      agentIdFilter.has(agent.id) || agentIdFilter.has(resolveRootAgentId(agent.id, agentsById)),
  );
}

export interface UseVisualizerEventAdapterInput {
  serverId: string;
  workspaceId: string;
  /** Gate on the page's `ready` handshake AND pane visibility — every
   * transition to `true` does a full reset + replay, which is also how the
   * adapter recovers from the hidden-webview rAF stall (see visualizer.md
   * Risks: "Hidden panes stop the world"). */
  active: boolean;
  /** Restrict sessions to this agent-id set (Runs "Visualize" scoping). Null
   * (default) shows every attended root agent in the workspace. */
  agentIdFilter?: ReadonlySet<string> | null;
  postMessage: (message: VisualizerHostToPageMessage) => void;
}

export function useVisualizerEventAdapter(input: UseVisualizerEventAdapterInput): void {
  const { serverId, workspaceId, active, agentIdFilter = null, postMessage } = input;
  const client = useHostRuntimeClient(serverId);
  const postMessageRef = useRef(postMessage);
  postMessageRef.current = postMessage;

  useEffect(() => {
    if (!active || !client) {
      return;
    }
    const state = createAdapterState();
    // An object (not a bare boolean) so lifecycle checks inside closures read
    // the live value after cleanup flips it — a plain `let` mutated only from
    // the returned cleanup reads as "never modified" to callers captured
    // earlier in this closure.
    const lifecycle = { disposed: false };

    postMessageRef.current({ type: "reset" });
    void getHostRuntimeStore()
      .refreshAgentDirectory({ serverId })
      .catch(() => undefined);

    const runBackfillQueue = async () => {
      // Sequential on purpose — a busy workspace shouldn't burst a pile of
      // full-history fetches at the daemon all at once.
      while (state.pendingBackfill.length > 0 && !lifecycle.disposed) {
        const agentId = state.pendingBackfill.shift();
        if (agentId) {
          await backfillAgentTimeline({ state, client, agentId });
        }
      }
    };

    const flushAfterBackfill = async () => {
      await runBackfillQueue();
      if (!lifecycle.disposed) {
        flush(state, postMessageRef.current);
      }
    };

    void (async () => {
      reconcileAgents(state, selectWorkspaceAgents(serverId, workspaceId, agentIdFilter));
      await flushAfterBackfill();
    })();

    const unsubscribeStore = useSessionStore.subscribe((current, previous) => {
      if (lifecycle.disposed) {
        return;
      }
      // The session store mutates on every state change across every
      // connected server; only this server's agents map matters here, and the
      // store always installs a fresh Map when it changes (setAgents bails
      // out on identity), so a reference check is a sound cheap gate.
      if (current.sessions[serverId]?.agents === previous.sessions[serverId]?.agents) {
        return;
      }
      reconcileAgents(state, selectWorkspaceAgents(serverId, workspaceId, agentIdFilter));
      if (state.pendingBackfill.length > 0) {
        void flushAfterBackfill();
      }
    });

    const unsubscribeStream = client.on("agent_stream", (message) => {
      if (lifecycle.disposed || message.type !== "agent_stream") {
        return;
      }
      const { agentId, event, timestamp, seq, epoch } = message.payload;
      const node = state.nodes.get(agentId);
      if (!node) {
        // Not a node we're tracking for this workspace/session set — the next
        // agent_update-driven reconcile will pick it up if it should be.
        return;
      }
      const envelope: LiveEnvelope = {
        event,
        time: toSimTime(state, Date.parse(timestamp)),
        seq,
        epoch,
      };
      if (node.cursor === null) {
        node.bufferedLive.push(envelope);
        return;
      }
      applyLiveEnvelope(state, node, envelope);
    });

    const flushTimer = setInterval(() => {
      if (!lifecycle.disposed) {
        flush(state, postMessageRef.current);
      }
    }, LIVE_FLUSH_INTERVAL_MS);

    return () => {
      lifecycle.disposed = true;
      clearInterval(flushTimer);
      unsubscribeStore();
      unsubscribeStream();
    };
    // agentIdFilter is compared by reference (Set identity) — callers must
    // memoize it (see visualizer-panel.tsx) so an unrelated re-render doesn't
    // spuriously reset + replay the whole session.
  }, [active, client, serverId, workspaceId, agentIdFilter]);
}
