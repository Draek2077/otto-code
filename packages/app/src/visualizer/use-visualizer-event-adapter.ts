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
import type { AgentLifecycleStatus } from "@otto-code/protocol/agent-lifecycle";
import type { AgentTimelineItem } from "@otto-code/protocol/agent-types";
import type { AgentStreamEventPayload } from "@otto-code/protocol/messages";
import { getHostRuntimeStore, useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore, type Agent } from "@/stores/session-store";
import {
  buildAgentCompleteEvent,
  buildAgentIdleEvent,
  buildAgentRenameEvent,
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
  type PersonalityNodeColors,
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
  /** The agent's own working directory — file paths reported by its tool calls
   * are displayed relative to this (see `AgentNodeContext.workspaceRoot`). */
  workspaceRoot: string;
  lastModel: string | null;
  lastTitle: string | null;
  /** `glowA|glowB` of the personality colors last sent to the page, so a live
   * personality switch (which updates the agent snapshot's personalitySpinner)
   * re-emits the spawn with the new tint. Null when the agent has no bound
   * personality. */
  lastPersonaColorKey: string | null;
  /** The agent's most recent lifecycle status, refreshed every reconcile. Read
   * at the tail of backfill to settle a resting (idle, non-terminal) node at
   * 'idle' — a finished turn's `turn_completed` is live-only and absent from
   * the replayed timeline, so without this a reopened idle chat ends the replay
   * pulsing 'thinking'. See `backfillAgentTimeline`. */
  lastStatus: AgentLifecycleStatus;
  terminalEmitted: boolean;
  /** True once a root node's session has been removed from the page because the
   * chat was archived. Archiving is a removal, not a completion — the session
   * disappears (page returns to "Waiting for chat activity" / auto-selects a
   * remaining chat) rather than lingering as a green "completed" node. Cleared
   * if the chat is un-archived so the session can be re-added. */
  sessionRemoved: boolean;
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
  /** In-flight streaming message accumulation. The daemon streams assistant/
   * reasoning/user text as DELTAS (Claude's emitNewContent slices off the
   * already-emitted length; other providers chunk similarly), keyed by a
   * stable messageId where the provider supplies one. Emitting a `message`
   * SimulationEvent per delta made the page draw one bubble per token-chunk —
   * dozens of tiny boxes for a single message. We instead accumulate
   * contiguous same-message deltas and emit ONE whole-message event when the
   * message settles (a different message starts, a tool call / turn event
   * intervenes, or backfill ends), mirroring the daemon's projected-timeline
   * assistant/reasoning merge (timeline-projection.ts) but for the live path. */
  streamingMessage: StreamingMessage | null;
}

type StreamingMessageRole = "user" | "assistant" | "thinking";

interface StreamingMessage {
  /** messageId when the provider supplies one, else the role — so contiguous
   * deltas of one message merge, while a role/message change starts a fresh
   * bubble. messageIds are provider-unique (UUID-ish), so they never collide
   * with the role-fallback strings. */
  key: string;
  role: StreamingMessageRole;
  text: string;
  /** Sim-time of the latest delta; stamps the emitted whole-message event. */
  time: number;
}

interface AdapterState {
  nodes: Map<string, TrackedNode>;
  /** Names already assigned within a session, for collision suffixing. */
  sessionNames: Map<string, Set<string>>;
  pending: SimulationEvent[];
  pendingSessionMessages: VisualizerHostToPageMessage[];
  /** Agent ids that just got a node and still need their timeline fetched. */
  pendingBackfill: string[];
  /** The in-flight `runBackfillQueue` drain, or null when idle. A single-flight
   * handle: the initial hydration sequence and the store-subscribe reconcile
   * both drive backfill, and letting them drain the shared `pendingBackfill`
   * queue concurrently is what let `hydrating` flip false mid-backfill. A
   * second caller awaits THIS promise instead of starting a rival loop (see
   * `hydrating` below). */
  backfillDrain: Promise<void> | null;
  /** Fallback wall-clock anchor for event times (adapter activation). The
   * page's simulation clock runs in SECONDS from ~0 (rAF dt accumulation);
   * every constant it ages against (TOOL_MAX_RUNNING_S etc.) and its m:ss
   * readout assume that scale. Feeding raw epoch-ms slammed the sim clock
   * ~1.7e12 ahead on every event, so relative seconds are mandatory. Used only
   * when a session has no registered anchor yet — real event times go through
   * {@link AdapterState.sessionEpochMs}. Session-message fields
   * (startTime/lastActivityTime) stay epoch-ms — the page mixes those with its
   * own Date.now(). */
  epochMs: number;
  /** Per-session (root agent id -> epoch ms) time anchor: the session's own
   * start (root `createdAt`). Every event is stamped `(ms - anchor)/1000` so
   * backfilled history keeps its REAL relative spread — a 17-second turn reads
   * as 17 seconds, an hour-long run spans an hour — instead of collapsing to
   * ~0. This is what lets the Execution Timeline and the scrubber show "what
   * you missed" with true shape, and lets a rewind land on the start rather
   * than emptying the canvas to the "Waiting for chat activity" backdrop.
   *
   * Safe against the page's `Math.max(event.time, currentTime)` floor
   * (use-agent-simulation.ts) because the page COLD-RESTARTS its sim clock to 0
   * on every session select (index.tsx session-switch useLayoutEffect), so a
   * session's 0-based history always replays from clock 0 and spreads. Anchored
   * at the root, whose `createdAt` precedes all of its (and its subagents')
   * activity, so every time stays >= 0. */
  sessionEpochMs: Map<string, number>;
  /** True until the initial hydration is genuinely quiescent: every batch
   * flushed in this window is marked `hydrate` so the page settles it to its
   * end state instead of animating the whole history back in (spawn/tool
   * bursts, sound). It stays true until the directory refresh has resolved AND
   * the backfill queue has drained with nothing in flight — NOT merely until
   * the first `flushAfterBackfill` resolves. That earlier one-shot flip raced
   * the `refreshAgentDirectory` store update: agents that first appeared via
   * the refresh backfilled AFTER the flip and streamed out un-hydrated, so the
   * page animated the whole run back in on first open. See
   * visualizer-view-types.ts and docs/visualizer.md "Hydrate on attach". */
  hydrating: boolean;
}

function createAdapterState(): AdapterState {
  return {
    nodes: new Map(),
    sessionNames: new Map(),
    pending: [],
    pendingSessionMessages: [],
    pendingBackfill: [],
    backfillDrain: null,
    epochMs: Date.now(),
    sessionEpochMs: new Map(),
    hydrating: true,
  };
}

/** Epoch-ms -> page simulation seconds, anchored at the session's own start
 * when known (see {@link AdapterState.sessionEpochMs}) so a session's events
 * keep their real relative spread, else at adapter activation. Always >= 0. */
function toSimTime(state: AdapterState, epochMs: number, sessionId?: string): number {
  if (!Number.isFinite(epochMs)) {
    return 0;
  }
  const anchor =
    (sessionId != null ? state.sessionEpochMs.get(sessionId) : undefined) ?? state.epochMs;
  return Math.max(0, (epochMs - anchor) / 1000);
}

function nodeCtx(node: TrackedNode): AgentNodeContext {
  return { name: node.name, sessionId: node.sessionId, workspaceRoot: node.workspaceRoot };
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

/** THE keying contract between the adapter and its hosts: a visualizer page
 * session is keyed on its ROOT agent's id verbatim (see `ensureNode`, which
 * sets `sessionId: rootId`). Host code that treats a root chat's agent id as a
 * page session id (e.g. the panel's follow-the-active-chat logic matching the
 * workspace's focusedAgentId against `session-state` ids) must go through this
 * helper, so a future keying change has one named seam instead of a comment. */
export function sessionIdForRootAgent(agentId: string): string {
  return agentId;
}

/** A draft chat tab (a chat that hasn't started an agent yet) is surfaced as an
 * EMPTY visualizer session so it appears in the toolbar's chats dropdown and,
 * when selected, shows the page's "Waiting for chat activity" empty state (a
 * session with no events puts no agents on the canvas → `isEmpty`). Keyed on the
 * draft id with a `draft:` prefix so it can never collide with an agent-id
 * session. When the draft gets its first message it retargets to an `agent` tab:
 * the draft session is closed (it leaves the tab set) and the real agent session
 * appears via the normal path. This is what makes `/clear` (archive current +
 * open fresh draft) settle on the empty draft instead of the thrown-away chat. */
export function sessionIdForDraft(draftId: string): string {
  return `draft:${draftId}`;
}

/** Ensures a tracked node exists for `agentId`, recursively registering any
 * observed-subagent ancestor first so `parent`/`sessionId` resolve correctly.
 * Returns undefined only if `agentId` isn't in `agentsById` at all. */
/** The personality's identity colors for this agent, when it was spawned from
 * an Agent Personality (both glow colors present). Feeds the spawn payload so
 * the page can tint the node's idle/thinking states in the personality. */
function personaColorsOf(agent: Agent): PersonalityNodeColors | null {
  const spinner = agent.personalitySpinner;
  if (spinner?.glowA && spinner.glowB) {
    return { glowA: spinner.glowA, glowB: spinner.glowB };
  }
  return null;
}

/** Stable key for change detection across snapshots. */
function personaColorKey(colors: PersonalityNodeColors | null): string | null {
  return colors ? `${colors.glowA}|${colors.glowB}` : null;
}

/** The spawn event (root or observed-subagent shape) for an already-tracked
 * node — used both to re-color on a live personality switch and to resurrect a
 * settled node that revived. Spawn of an existing name is a reactivate on the
 * page, so it preserves accumulated stats while applying the new payload. */
function buildReSpawnEvent(
  state: AdapterState,
  node: TrackedNode,
  agent: Agent,
  personaColors: PersonalityNodeColors | null,
  time: number,
): SimulationEvent {
  if (node.isRoot) {
    return buildRootAgentSpawnEvent({
      ctx: nodeCtx(node),
      model: agent.model,
      provider: agent.provider,
      personalityColors: personaColors,
      time,
    });
  }
  const parentNode = agent.parentAgentId ? state.nodes.get(agent.parentAgentId) : undefined;
  return buildObservedSubagentSpawnEvent({
    ctx: nodeCtx(node),
    parentName: parentNode?.name ?? agent.parentAgentId ?? node.sessionId,
    task: agent.title,
    personalityColors: personaColors,
    time,
  });
}

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
  if (isRoot) {
    // Anchor the session's timeline at its own start (root createdAt) so every
    // event in it keeps real relative spread (see AdapterState.sessionEpochMs).
    // Set before any of the session's events are stamped below.
    state.sessionEpochMs.set(rootId, time);
  }

  const usedNames = state.sessionNames.get(rootId) ?? new Set<string>();
  state.sessionNames.set(rootId, usedNames);
  const name = resolveAgentNodeName({ agentId, title: agent.title, usedNames });
  usedNames.add(name);

  const personaColors = personaColorsOf(agent);
  const node: TrackedNode = {
    sessionId: rootId,
    name,
    isRoot,
    workspaceRoot: agent.cwd,
    lastModel: agent.model,
    lastTitle: agent.title,
    lastPersonaColorKey: personaColorKey(personaColors),
    lastStatus: agent.status,
    terminalEmitted: false,
    sessionRemoved: false,
    cursor: null,
    bufferedLive: [],
    startedToolCallIds: new Set(),
    subAgentDispatchLabels: new Map(),
    lastContextTokens: null,
    lastCumulativeTokens: null,
    streamingMessage: null,
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
        personalityColors: personaColors,
        time: toSimTime(state, time, node.sessionId),
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
        personalityColors: personaColors,
        time: toSimTime(state, time, node.sessionId),
      }),
    );
  }
  return node;
}

/** Removes a tracked node whose agent has genuinely left the authoritative
 * set — the graph must stop showing an agent that no longer exists, or the
 * canvas drifts out of sync with the chat's real state ("too many agents").
 * A root drives the page's close-session (its whole session is gone, same as
 * archive); a non-root fades via agent_complete (the page's only node-removal
 * signal). The node is dropped from tracking and its name freed so a later
 * re-appearance registers fresh. */
function pruneVanishedNode(state: AdapterState, agentId: string, node: TrackedNode): void {
  if (node.isRoot) {
    if (!node.sessionRemoved) {
      state.pendingSessionMessages.push({ type: "close-session", sessionId: node.sessionId });
    }
    // The whole session is gone; drop its time anchor too.
    state.sessionEpochMs.delete(node.sessionId);
  } else if (!node.terminalEmitted) {
    state.pending.push(
      buildAgentCompleteEvent({
        ctx: nodeCtx(node),
        time: toSimTime(state, Date.now(), node.sessionId),
      }),
    );
  }
  state.nodes.delete(agentId);
  state.sessionNames.get(node.sessionId)?.delete(node.name);
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
      const time = toSimTime(state, agent.lastActivityAt.getTime(), node.sessionId);
      if (agent.model && agent.model !== node.lastModel) {
        node.lastModel = agent.model;
        state.pending.push(
          buildModelDetectedEvent({ ctx: nodeCtx(node), model: agent.model, time }),
        );
      }
      if (node.isRoot && agent.title && agent.title !== node.lastTitle) {
        node.lastTitle = agent.title;
        // The toolbar dropdown (session label, truncated) AND the graph node
        // (display name, full title) both track the chat title — the node is
        // keyed on its frozen spawn name, so agent_rename relabels it in place.
        state.pendingSessionMessages.push({
          type: "session-updated",
          sessionId: node.sessionId,
          label: truncateSessionLabel(agent.title),
        });
        state.pending.push(
          buildAgentRenameEvent({ ctx: nodeCtx(node), label: agent.title.trim(), time }),
        );
      }
      // Live personality switch: the running agent's identity colors changed,
      // so re-emit the spawn (a reactivate for an existing name) carrying the
      // new tint. Skipped when unchanged so a normal snapshot push is inert.
      // Also skipped for a node that already completed or whose session was
      // removed: a spawn would resurrect a faded node that the terminal branch
      // can never re-complete (terminalEmitted stays true), and for an
      // archived root it would target an already-closed session. A completed
      // node keeping its old colors is correct; if the row genuinely revives,
      // the resurrection path below re-spawns it with the current colors.
      const personaColors = personaColorsOf(agent);
      const personaKey = personaColorKey(personaColors);
      if (personaKey !== node.lastPersonaColorKey) {
        node.lastPersonaColorKey = personaKey;
        if (!node.terminalEmitted && !node.sessionRemoved) {
          state.pending.push(buildReSpawnEvent(state, node, agent, personaColors, time));
        }
      }
    }

    reconcileNodeTokens(state, node, agent);
    reconcileNodeLifecycle(state, node, agent);
  }

  // Prune-to-truth: any tracked node whose agent is no longer in the
  // authoritative set has genuinely left (closed + swept from the store,
  // moved workspace, dropped from a run-scoped filter) — remove it so the
  // canvas matches the chat's current reality instead of lingering.
  //
  // Gated on `!hydrating`: during the initial attach window
  // `selectWorkspaceAgents` is a partial, pre-`refreshAgentDirectory` view,
  // and pruning against it would drop agents the refresh is about to add
  // (churn / "not enough agents"). Once hydration settles, every reconcile is
  // driven by an authoritative whole-map store replace, so an absent agent is
  // a real removal. Collect ids first — pruneVanishedNode mutates state.nodes.
  if (!state.hydrating) {
    const vanished: [string, TrackedNode][] = [];
    for (const [agentId, node] of state.nodes) {
      if (!agentsById.has(agentId)) {
        vanished.push([agentId, node]);
      }
    }
    for (const [agentId, node] of vanished) {
      pruneVanishedNode(state, agentId, node);
    }
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
    time: toSimTime(state, agent.lastActivityAt.getTime(), node.sessionId),
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
  // Track the freshest status so backfill can settle a resting node at 'idle'
  // (see TrackedNode.lastStatus).
  node.lastStatus = agent.status;
  // Archiving a root chat is a REMOVAL, not a completion. The user threw the
  // chat away — its session should disappear from the visualizer (the page
  // returns to "Waiting for chat activity" or auto-selects a remaining chat),
  // not fade to a green "completed" node that stays selected and plays the
  // completion chord. So drive the page's close-session/removeSession path
  // instead of the agent_complete + session-ended a natural terminal takes.
  // (Non-root nodes have no session of their own; they keep fading via the
  // terminal path below when the whole chat isn't archived out from under
  // them.)
  const archived = Boolean(agent.archivedAt);
  if (node.isRoot) {
    if (archived && !node.sessionRemoved) {
      node.sessionRemoved = true;
      // Suppress the terminal branch below (archived is terminal) so no
      // agent_complete fires for the now-removed session.
      node.terminalEmitted = true;
      state.pendingSessionMessages.push({ type: "close-session", sessionId: node.sessionId });
      return;
    }
    if (!archived && node.sessionRemoved) {
      // Un-archived while attached: bring the session (and its node) back.
      node.sessionRemoved = false;
      node.terminalEmitted = false;
      state.pendingSessionMessages.push({
        type: "session-started",
        session: {
          id: node.sessionId,
          label: truncateSessionLabel(agent.title ?? node.name),
          status: "active",
          startTime: agent.createdAt.getTime(),
          lastActivityTime: agent.lastActivityAt.getTime(),
        },
      });
      state.pending.push(
        buildReSpawnEvent(
          state,
          node,
          agent,
          personaColorsOf(agent),
          toSimTime(state, agent.lastActivityAt.getTime(), node.sessionId),
        ),
      );
      // Fall through to normal lifecycle so a chat un-archived straight into a
      // terminal status still settles correctly.
    }
  }

  const isTerminal = isVisualizerAgentTerminal({
    status: agent.status,
    attend: agent.attend,
    archived: Boolean(agent.archivedAt),
    requiresAttention: Boolean(agent.requiresAttention),
  });
  const time = toSimTime(state, agent.lastActivityAt.getTime(), node.sessionId);
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
    state.pending.push(buildReSpawnEvent(state, node, agent, personaColorsOf(agent), time));
  }
}

type MessageTimelineItem = Extract<
  AgentTimelineItem,
  { type: "user_message" | "assistant_message" | "reasoning" }
>;

function isMessageTimelineItem(item: AgentTimelineItem): item is MessageTimelineItem {
  return (
    item.type === "user_message" || item.type === "assistant_message" || item.type === "reasoning"
  );
}

function messageItemRole(item: MessageTimelineItem): StreamingMessageRole {
  if (item.type === "user_message") {
    return "user";
  }
  if (item.type === "assistant_message") {
    return "assistant";
  }
  return "thinking";
}

function messageBubbleKey(item: MessageTimelineItem, role: StreamingMessageRole): string {
  return "messageId" in item && item.messageId ? item.messageId : role;
}

/** Emits the held streaming message as one whole-message event (or nothing if
 * none is held / it accumulated no text) and clears the hold. */
function flushStreamingMessage(node: TrackedNode): SimulationEvent[] {
  const held = node.streamingMessage;
  if (!held) {
    return [];
  }
  node.streamingMessage = null;
  if (held.text.length === 0) {
    return [];
  }
  return [
    {
      time: held.time,
      sessionId: node.sessionId,
      type: "message",
      payload: { agent: node.name, content: held.text, role: held.role },
    },
  ];
}

/** Accumulates one message delta into the node's in-flight bubble instead of
 * emitting it immediately (see {@link TrackedNode.streamingMessage}). A delta
 * for a different message than the one held first flushes the held one; the
 * delta itself emits nothing — the whole message is emitted on settle. */
function accumulateStreamingMessage(
  node: TrackedNode,
  item: MessageTimelineItem,
  time: number,
): SimulationEvent[] {
  const role = messageItemRole(item);
  const key = messageBubbleKey(item, role);
  const events: SimulationEvent[] = [];
  const held = node.streamingMessage;
  if (held && held.key !== key) {
    events.push(...flushStreamingMessage(node));
  }
  const current = node.streamingMessage;
  if (current && current.key === key) {
    current.text += item.text;
    current.time = time;
  } else {
    node.streamingMessage = { key, role, text: item.text, time };
  }
  return events;
}

/** Maps a timeline item through the pure adapter while maintaining the
 * node's sent-start callId bookkeeping (see `startedToolCallIds`) and
 * streaming-message accumulation (see `streamingMessage`). */
function trackedTimelineItemEvents(node: TrackedNode, item: AgentTimelineItem, time: number) {
  if (isMessageTimelineItem(item)) {
    return accumulateStreamingMessage(node, item, time);
  }
  // Any non-message item settles a held streaming message before its own
  // events, so the whole-message bubble lands in timeline order (e.g. the
  // assistant text that preceded a tool call is emitted just before the
  // tool_call_start).
  const settled = flushStreamingMessage(node);
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
          return [
            ...settled,
            buildSubagentDispatchEvent({ ctx: nodeCtx(node), detail: item.detail, time }),
          ];
        }
      }
      return settled;
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
  return [
    ...settled,
    ...timelineItemToSimulationEvents({
      ctx: nodeCtx(node),
      item,
      time,
      synthesizeToolCallStart,
    }),
  ];
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
  // A non-timeline stream event (turn_completed/turn_failed/permission…) marks
  // the end of the turn's streaming — settle any in-flight message before the
  // event's own effects (idle/context) so the whole-message bubble lands first.
  state.pending.push(...flushStreamingMessage(node));
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
  let lastReplayTime = 0;
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
      const time = toSimTime(state, Date.parse(entry.timestamp), node.sessionId);
      lastReplayTime = Math.max(lastReplayTime, time);
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
    lastReplayTime = Math.max(lastReplayTime, envelope.time);
    applyLiveEnvelope(state, node, envelope);
  }
  // Backfill entries are already-merged whole messages (projection:"projected")
  // and any buffered live deltas have continued the trailing one — nothing
  // follows the last message to settle it, so flush it now. (A message still
  // streaming live at attach may then split across this boundary: the settled
  // portion shows as one bubble and later live deltas start another — a rare
  // cosmetic case, far better than the pre-fix bubble-per-delta.)
  state.pending.push(...flushStreamingMessage(node));
  // An agent that was already terminal at attach had its agent_complete
  // emitted by the registering reconcile — BEFORE this replay appended the
  // historical timeline into the same batch. The page's tool/message handlers
  // carry no completed-guard, so the replayed history revives the node into
  // thinking/tool_calling and nothing ever completes it again
  // (terminalEmitted is already true). Re-assert the terminal transition at
  // the tail so the page's last word on a finished agent is its completion.
  // Archived roots were REMOVED (close-session), not completed — skip those.
  if (node.terminalEmitted && !node.sessionRemoved) {
    state.pending.push(buildAgentCompleteEvent({ ctx: nodeCtx(node), time: lastReplayTime }));
  } else if (!node.terminalEmitted && node.lastStatus === "idle") {
    // A resting (idle, non-terminal) agent finished its last turn, but that
    // turn's `turn_completed` is a LIVE-only stream event — it never lands in
    // the replayed timeline. So the replay above ends on the last assistant/
    // tool item and leaves the node pulsing 'thinking'. Re-assert the resting
    // idle at the tail so a reopened idle chat settles at 'idle', exactly as a
    // live turn_completed would. (A `running` agent is genuinely mid-turn — its
    // node stays 'thinking' and the live turn_completed idles it later.)
    state.pending.push(
      buildAgentIdleEvent({ ctx: nodeCtx(node), time: lastReplayTime, resting: true }),
    );
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
    } else if (
      message.type === "session-updated" ||
      message.type === "session-ended" ||
      message.type === "close-session"
    ) {
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
    // While `hydrating` (the one-shot backfill window), tag the batch so the
    // page settles it to the end state instead of replaying the whole history
    // animation — the user is bringing an existing chat into view, not
    // watching it happen. Live batches after the window animate normally.
    postMessage({
      type: "agent-event-batch",
      events,
      ...(state.hydrating ? { hydrate: true } : {}),
    });
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
  /** Draft chat tabs open in this workspace (tabs of `kind: "draft"` — a chat
   * that hasn't started an agent yet). Each is surfaced as an empty session
   * (see {@link sessionIdForDraft}) so it shows in the chats dropdown and reads
   * "Waiting for chat activity" when selected. MEMOIZE the array in the caller:
   * a new identity re-runs the lightweight draft sync, but NOT the agent
   * reset+replay. */
  draftSessions?: readonly DraftSessionInput[];
  postMessage: (message: VisualizerHostToPageMessage) => void;
}

/** One draft chat tab surfaced as an empty visualizer session. */
export interface DraftSessionInput {
  /** The workspace draft tab's `draftId`. */
  draftId: string;
  /** Dropdown label — "New chat" until the draft becomes a real agent. */
  label: string;
}

const EMPTY_DRAFT_SESSIONS: readonly DraftSessionInput[] = [];

export function useVisualizerEventAdapter(input: UseVisualizerEventAdapterInput): void {
  const {
    serverId,
    workspaceId,
    active,
    agentIdFilter = null,
    draftSessions = EMPTY_DRAFT_SESSIONS,
    postMessage,
  } = input;
  const client = useHostRuntimeClient(serverId);
  const postMessageRef = useRef(postMessage);
  postMessageRef.current = postMessage;
  // Draft sessions live OUTSIDE the per-activation adapter `state` (they carry
  // no events/backfill — just a session-started/close-session pair) so the
  // lightweight draft-sync effect below can diff them without the agent
  // reset+replay. Maps a draft session id -> its last-posted label. The main
  // effect clears this right after it posts `reset` (which wipes the page's
  // session list), so the draft-sync effect re-emits every draft afterwards.
  const registeredDraftsRef = useRef<Map<string, string>>(new Map());

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
    // `reset` cleared the page's session list — forget which drafts were
    // registered so the draft-sync effect (which runs after this one on any
    // reset-dep change) re-emits them all against the fresh page.
    registeredDraftsRef.current.clear();

    const drainBackfillQueue = async (): Promise<void> => {
      // Sequential on purpose — a busy workspace shouldn't burst a pile of
      // full-history fetches at the daemon all at once.
      while (state.pendingBackfill.length > 0 && !lifecycle.disposed) {
        const agentId = state.pendingBackfill.shift();
        if (agentId) {
          await backfillAgentTimeline({ state, client, agentId });
        }
      }
    };
    const runBackfillQueue = (): Promise<void> => {
      // Single-flight: the initial hydration sequence and the store
      // subscription both call this, and two loops shifting the same queue
      // concurrently is what let `hydrating` flip false while a backfill was
      // still in flight. A second caller awaits the in-flight drain rather
      // than starting a rival loop (or busy-spinning on a boolean guard).
      if (state.backfillDrain) {
        return state.backfillDrain;
      }
      const drain = drainBackfillQueue();
      state.backfillDrain = drain;
      // Clear via .finally (a microtask) so the assignment above lands first —
      // an empty queue makes `drain` settle synchronously, and a `finally {}`
      // INSIDE the async body would run before this assignment and strand
      // `backfillDrain` non-null forever (spinning the hydration while-loop).
      // The identity guard keeps a superseding drain from being cleared.
      void drain.finally(() => {
        if (state.backfillDrain === drain) {
          state.backfillDrain = null;
        }
      });
      return drain;
    };

    const flushAfterBackfill = async () => {
      await runBackfillQueue();
      if (!lifecycle.disposed) {
        flush(state, postMessageRef.current);
      }
    };

    void (async () => {
      // The authoritative directory refresh (observed subagents, agents that
      // hadn't synced into the store yet) is a network RPC with no dependency
      // on the first drain, so START it now and only await it below —
      // overlapping it with the first backfill drain instead of serializing
      // drain → refresh → drain. Its store update fires the subscription below
      // (registering + queuing those agents); mid-drain reconciles are safe
      // because the backfill queue is single-flight (runBackfillQueue) and the
      // quiescence loop re-drains anything they enqueue.
      const refreshDirectory = getHostRuntimeStore()
        .refreshAgentDirectory({ serverId })
        .catch(() => undefined);
      // Fast first paint from whatever the store already holds — reconcile and
      // hydrate it immediately so the graph appears settled without waiting on
      // the network.
      reconcileAgents(state, selectWorkspaceAgents(serverId, workspaceId, agentIdFilter));
      await flushAfterBackfill();
      // The refresh MUST complete before we leave the hydrate window: an agent
      // that first appears via it would otherwise backfill after `hydrating`
      // flipped false and animate its whole history — the "replay on first
      // open" bug.
      await refreshDirectory;
      if (lifecycle.disposed) {
        return;
      }
      reconcileAgents(state, selectWorkspaceAgents(serverId, workspaceId, agentIdFilter));
      await flushAfterBackfill();
      // Keep hydrating until the queue is genuinely quiescent — a reconcile
      // triggered during the flush above (or a still-running subscribe drain)
      // can enqueue more history that must also settle, not animate.
      while (!lifecycle.disposed && (state.pendingBackfill.length > 0 || state.backfillDrain)) {
        await flushAfterBackfill();
      }
      // Everything from here is genuinely-live activity the user is watching —
      // animate it.
      state.hydrating = false;
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
        time: toSimTime(state, Date.parse(timestamp), node.sessionId),
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

  // ── Draft sessions ─────────────────────────────────────────────────────────
  // Surface each draft chat tab as an empty session so it shows in the dropdown
  // and reads "Waiting for chat activity" when selected. Runs AFTER the main
  // effect (declaration order → its body runs first), so on any reset-dep change
  // the main effect has already posted `reset` + cleared registeredDraftsRef and
  // this re-emits every draft against the fresh page. When only `draftSessions`
  // changes (a draft opened/closed, or became an agent → left the set), the main
  // effect doesn't re-run, so this just diffs against the persisted ref. Kept
  // separate from the agent reset+replay on purpose: adding/removing a draft
  // must not re-backfill live chats. The reset-scoped deps are included so a
  // reset with an unchanged draft list (e.g. an agentIdFilter change) still
  // re-emits.
  useEffect(() => {
    if (!active || !client) {
      return;
    }
    const registered = registeredDraftsRef.current;
    const wanted = new Map(
      draftSessions.map((draft) => [sessionIdForDraft(draft.draftId), draft.label] as const),
    );
    // Deleting the current key while iterating a Map's keys() is safe per spec
    // (the iterator won't revisit it), so no snapshot copy is needed.
    for (const sessionId of registered.keys()) {
      if (!wanted.has(sessionId)) {
        postMessageRef.current({ type: "close-session", sessionId });
        registered.delete(sessionId);
      }
    }
    for (const [sessionId, label] of wanted) {
      const prevLabel = registered.get(sessionId);
      if (prevLabel === undefined) {
        postMessageRef.current({
          type: "session-started",
          session: {
            id: sessionId,
            label,
            status: "active",
            // Fixed low timestamps: the dropdown renders only the label (the
            // times are never shown), and keeping them at 0 stops an empty draft
            // from ever out-sorting a live chat in the page's most-recent
            // auto-select. The focused-tab follow logic is what actually selects
            // a draft (e.g. right after /clear).
            startTime: 0,
            lastActivityTime: 0,
          },
        });
        registered.set(sessionId, label);
      } else if (prevLabel !== label) {
        postMessageRef.current({ type: "session-updated", sessionId, label });
        registered.set(sessionId, label);
      }
    }
  }, [active, client, serverId, workspaceId, agentIdFilter, draftSessions]);
}
