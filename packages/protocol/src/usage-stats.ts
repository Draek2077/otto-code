import { z } from "zod";

/**
 * Otto usage and activity-stats wire schemas: the usage.log.get and stats.activity.* RPCs, the usage event, and the activity counters push. Fork-only capability, so it owns its schemas; messages.ts re-exports them.
 */

// Daemon-wide "fun stats" counters - see docs/data-model.md ActivityStatsStore.
// Every field defaults to 0 so old and new daemons/clients stay compatible as
// counters are added later.
export const ActivityCountersSchema = z.object({
  messagesSent: z.number().default(0),
  messagesReceived: z.number().default(0),
  tokensSent: z.number().default(0),
  tokensReceived: z.number().default(0),
  agentsCreated: z.number().default(0),
  runsOrchestrated: z.number().default(0),
  subagentsInvoked: z.number().default(0),
  backgroundTasksInvoked: z.number().default(0),
  thoughts: z.number().default(0),
  toolsCalled: z.number().default(0),
  artifactsCreated: z.number().default(0),
  schedulesExecuted: z.number().default(0),
  // Usage & cost accounting (WP-G). Additive/defaulted like every counter above,
  // so old daemons emit 0 and old clients drop the unknown leaves. "In"/"Out"
  // are token totals; *CostMicroUsd are integer micro-USD (usd*1e6) to stay
  // summable - populated only for turns reporting a real provider cost (Claude).
  // The client detects whether the daemon actually populates these via
  // features.usageCostCategories (see below).
  costMicroUsd: z.number().default(0),
  mainChatTokensIn: z.number().default(0),
  mainChatTokensOut: z.number().default(0),
  mainChatCostMicroUsd: z.number().default(0),
  generationsTokensIn: z.number().default(0),
  generationsTokensOut: z.number().default(0),
  generationsCostMicroUsd: z.number().default(0),
  subagentTokensIn: z.number().default(0),
  subagentTokensOut: z.number().default(0),
  subagentCostMicroUsd: z.number().default(0),
  compactionTokensIn: z.number().default(0),
  compactionTokensOut: z.number().default(0),
  claudeTokensIn: z.number().default(0),
  claudeTokensOut: z.number().default(0),
});

export const StatsActivityGetRequestMessageSchema = z.object({
  type: z.literal("stats.activity.get.request"),
  requestId: z.string(),
});

export const StatsActivityGetResponseMessageSchema = z.object({
  type: z.literal("stats.activity.get.response"),
  payload: z.object({
    requestId: z.string(),
    today: ActivityCountersSchema,
    yesterday: ActivityCountersSchema,
    last7Days: ActivityCountersSchema,
    last30Days: ActivityCountersSchema,
    allTime: ActivityCountersSchema,
  }),
});

// Daemon-wide "activity counters moved" ping - broadcast to every client,
// coalesced at the daemon (at most once every few seconds) so bursts of
// increments don't get chatty. Carries no payload: clients re-fetch the
// rollups via stats.activity.get. Purely additive - old clients drop the
// unknown type with a warning, and against old daemons (which never send it)
// the stats screen degrades to today's focus/manual refresh. Rides the
// existing activityStats capability; no new feature flag needed because no
// client behavior depends on detecting it.
export const ActivityStatsChangedSchema = z.object({
  type: z.literal("activity_stats_changed"),
});

// One itemized row of the usage ledger - a single token/cost-bearing activity
// (a chat turn, a sub-agent turn, or a background generation). The aggregate
// ActivityCounters above are the rollup of this same event stream; the ledger is
// the scrollable detail behind the tiles (usage-ledger project). `kind` and
// `provider` are plain strings (not enums) so an OLD client still parses a NEW
// daemon that emits a kind it hasn't heard of - it renders it generically rather
// than failing the whole message. All token/cost leaves default to 0.
export const UsageEventSchema = z.object({
  /** Stable unique id for the row (daemon-generated). */
  id: z.string(),
  /** Epoch milliseconds when the activity was recorded. */
  at: z.number(),
  /** "chat" | "subagent" | "generation" today; open for future kinds. */
  kind: z.string(),
  /** Finer label within the kind (e.g. a generation's purpose, a sub-agent name). */
  subtype: z.string().optional(),
  /** Agent provider id (e.g. "claude", an openai-compat endpoint id). */
  provider: z.string(),
  /** Model id/name if known at the increment site. */
  model: z.string().optional(),
  /** input + cached + cache-creation tokens (same "in" split the counters use). */
  tokensIn: z.number().default(0),
  /**
   * The portion of `tokensIn` served from the provider prompt cache (cache-read),
   * billed at a fraction of fresh input. The fresh (full-rate) portion is
   * `tokensIn - cachedTokensIn`. Absent when the provider reports no cache reads
   * (e.g. openai-compat endpoints with no caching), which reads as all-fresh.
   */
  cachedTokensIn: z.number().optional(),
  /** output tokens. */
  tokensOut: z.number().default(0),
  /** Real provider spend in integer micro-USD (usd*1e6); 0 for token-only providers. */
  costMicroUsd: z.number().default(0),
  /** Mid-turn compaction slice folded into this turn's usage, if any (token-only). */
  compactionTokensIn: z.number().optional(),
  compactionTokensOut: z.number().optional(),
  /** The agent this activity belonged to, for tracing back to the chat. */
  agentId: z.string().optional(),
  /**
   * How many model round-trips this row aggregates. A chat row is one query, but
   * a sub-agent row covers a whole delegated task that internally ran many
   * rounds - and each round re-reads the growing context, so `cachedTokensIn` is
   * cumulative cache-READS, not a cache size. Surfacing the count is what makes a
   * large cached figure legible instead of looking like a bug. Absent when the
   * provider doesn't report it.
   */
  rounds: z.number().optional(),
  /**
   * Sub-agent rows only - the spawn-tree identity that lets the Log group rows
   * the way a human reads the run (chat turn → its sub-agents → their
   * sub-agents) instead of by settle time, which async sub-agents crossing turn
   * boundaries makes wrong. `startedAt` is when the sub-agent was first
   * observed (epoch ms; a row belongs to the turn that spawned it, not the turn
   * it happened to settle in), `subagentKey` is its stable observed key, and
   * `parentSubagentKey` is the spawning sub-agent's key - absent for depth-1
   * sub-agents spawned by the chat itself.
   */
  startedAt: z.number().optional(),
  subagentKey: z.string().optional(),
  parentSubagentKey: z.string().optional(),
});

export const UsageLogGetRequestMessageSchema = z.object({
  type: z.literal("usage.log.get.request"),
  requestId: z.string(),
  /** Max rows to return (daemon clamps). Newest-first. */
  limit: z.number().optional(),
  /** Cursor: return only rows strictly older than this epoch-ms (for "load more"). */
  before: z.number().optional(),
});

export const UsageLogGetResponseMessageSchema = z.object({
  type: z.literal("usage.log.get.response"),
  payload: z.object({
    requestId: z.string(),
    /** Newest-first page of ledger rows. */
    events: z.array(UsageEventSchema).default([]),
    /** True when older rows exist beyond this page (paginate with `before`). */
    hasMore: z.boolean().default(false),
  }),
});

// Wipe every daemon-wide usage counter AND the itemized usage ledger back to
// zero - the "Reset" action on the Metrics screen. One RPC clears both sinks
// (the day-bucketed ActivityStatsStore and the UsageLogStore) so the tiles and
// the Log tab start fresh together. Gated behind features.statsReset so an old
// daemon (no handler) never receives a request the client thinks it can send.
export const StatsActivityResetRequestMessageSchema = z.object({
  type: z.literal("stats.activity.reset.request"),
  requestId: z.string(),
});

export const StatsActivityResetResponseMessageSchema = z.object({
  type: z.literal("stats.activity.reset.response"),
  payload: z.object({
    requestId: z.string(),
  }),
});

export type ActivityCounters = z.infer<typeof ActivityCountersSchema>;

export type StatsActivityGetResponseMessage = z.infer<typeof StatsActivityGetResponseMessageSchema>;

export type StatsActivityResetRequestMessage = z.infer<
  typeof StatsActivityResetRequestMessageSchema
>;

export type StatsActivityResetResponseMessage = z.infer<
  typeof StatsActivityResetResponseMessageSchema
>;

export type ActivityStatsChanged = z.infer<typeof ActivityStatsChangedSchema>;

export type UsageEvent = z.infer<typeof UsageEventSchema>;

export type UsageLogGetRequestMessage = z.infer<typeof UsageLogGetRequestMessageSchema>;

export type UsageLogGetResponseMessage = z.infer<typeof UsageLogGetResponseMessageSchema>;
