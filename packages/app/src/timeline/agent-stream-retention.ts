// When the client is allowed to drop an agent's stream buffers.
//
// `agentStreamTail` / `agentStreamHead` are keyed by agent id and, until this
// module existed, were only ever cleared wholesale by `clearSession` (plus one
// per-agent clear on `agent_deleted`). Every agent that streamed anything —
// including agents whose chat was never opened, since `agent_stream` is
// reduced into the tail for every agent on the host — kept its whole timeline
// in memory for the life of the session. Two minutes of soak cannot show that;
// it is a property of the code, not a curve.
//
// The release trigger, decided rather than guessed:
//
//   An agent's stream buffers are released when the agent is not being
//   displayed AND either it has left the session (deleted / removed) or it is
//   past the retention cap, oldest activity first.
//
// "Not being displayed" is explicit, not inferred: every surface that renders
// from these buffers registers a retainer while it is mounted
// (`useAgentStreamRetention`). Inferring it from focus or lifecycle would blank
// a mounted background pane, which is exactly the failure mode an LRU over
// "what the store happens to know" produces.
//
// **Releasing must also invalidate the resume path.** The buffers are not a
// standalone cache: `agentTimelineCursor` + `agentAuthoritativeHistoryApplied`
// tell `planInitialAgentTimelineSync` that the client is already caught up, so
// the next open would issue an `after` catch-up that returns nothing and leave
// the chat empty. Dropping those alongside the buffers is what makes the next
// open plan a full `tail` fetch and rehydrate. `releaseAgentStreams` in the
// session store owns that pairing; do not split it.
//
// The Visualizer is unaffected: its backfill-and-replay path re-fetches from
// the daemon (`client.fetchAgentTimeline(agentId, {direction:"tail", limit:0})`
// in `use-visualizer-event-adapter.ts`), never from these buffers, so a
// released agent still replays in full when a Visualizer tab becomes visible.

/**
 * How many agents keep stream buffers per host. Sized as "more chats than a
 * session realistically has open at once, far fewer than a day's worth of
 * agents": the cap exists to bound a session, not to make switching chats
 * refetch. Anything still displayed is retained regardless of this number.
 */
export const AGENT_STREAM_MAX_RETAINED_AGENTS = 12;

export interface AgentStreamEvictionInput {
  /** Agents currently holding a tail and/or head. */
  bufferedAgentIds: readonly string[];
  /** Agents a mounted surface is rendering right now. Never evicted. */
  displayedAgentIds: ReadonlySet<string>;
  /** Agents that have left the session (deleted, removed, archived). */
  departedAgentIds?: ReadonlySet<string>;
  /** Recency, newest wins. A missing entry sorts as oldest. */
  lastActivityAtByAgentId: ReadonlyMap<string, number>;
  maxRetainedAgents?: number;
}

/**
 * Which agents to release, oldest activity first. Returns `[]` when nothing is
 * over the cap and nothing has departed — the common case, so callers can skip
 * the store write entirely.
 */
export function planAgentStreamEviction(input: AgentStreamEvictionInput): string[] {
  const {
    bufferedAgentIds,
    displayedAgentIds,
    departedAgentIds,
    lastActivityAtByAgentId,
    maxRetainedAgents = AGENT_STREAM_MAX_RETAINED_AGENTS,
  } = input;

  const evictable = bufferedAgentIds.filter((agentId) => !displayedAgentIds.has(agentId));

  // Departed agents go first and do not count against the cap: nothing can
  // render them, so holding their buffers is pure retention.
  const departed = departedAgentIds
    ? evictable.filter((agentId) => departedAgentIds.has(agentId))
    : [];
  const departedSet = new Set(departed);

  const cap = Math.max(1, maxRetainedAgents);
  const remaining = bufferedAgentIds.length - departed.length;
  const overCap = remaining - cap;
  if (overCap <= 0) {
    return departed;
  }

  const byOldestFirst = evictable
    .filter((agentId) => !departedSet.has(agentId))
    .sort((left, right) => {
      const leftAt = lastActivityAtByAgentId.get(left) ?? 0;
      const rightAt = lastActivityAtByAgentId.get(right) ?? 0;
      if (leftAt !== rightAt) {
        return leftAt - rightAt;
      }
      // Ties break on id so the same input always produces the same plan —
      // an eviction order that depends on Map insertion order is untestable.
      return left < right ? -1 : 1;
    });

  return [...departed, ...byOldestFirst.slice(0, overCap)];
}
