// One honest spend number per chat — the daemon-side half.
//
// Two problems live here, both provider-agnostic on purpose:
//
// 1. NOT EVERY PROVIDER REPORTS PER-TURN SPEND. Most report "what this turn
//    cost" (Claude, Codex, ACP, openai-compat, and OpenCode's token leaves), so
//    a lifetime total is a plain sum. But Pi's session stats are a LIFETIME
//    total for every leaf, and OpenCode's `totalCostUsd` is a running SESSION
//    total even though its token leaves are per-turn. Adding those every turn
//    double-books: turn 3 re-books turns 1 and 2, so the error grows
//    quadratically with chat length. {@link toTurnSpend} normalizes a cumulative
//    reporter into this turn's delta against a per-agent watermark, so
//    EVERYTHING downstream (the lifetime total, the activity counters, the
//    itemized ledger) is plain addition with no per-provider branch.
//
// 2. THE IN/CACHED/OUT SPLIT WAS DISCARDED BEFORE IT COULD BE PRICED. The
//    lifetime total used to be a single flattened scalar, so a cache read (~10%
//    of input price) counted the same as fresh input and no honest cost could be
//    derived from it after the fact. {@link accumulateLifetimeUsage} keeps the
//    split AND the provider's own real cost, accumulated at the moment usage is
//    first observed.
//
// Cost honesty: `costUsd` is only ever the provider's OWN reported cost. This
// module never prices tokens from a rate table — a rate keyed off a model id
// would misprice a gateway serving that model at its own prices (see the
// pricing invariant in docs/subagent-accounting.md). Providers that cannot
// report cost (local models, most openai-compatible endpoints) leave it unset
// and every surface shows an honest blank instead of a confident wrong figure.

import type { AgentProvider, AgentUsage } from "./agent-sdk-types.js";

/**
 * Which of a provider's usage leaves are a running total rather than this
 * turn's spend.
 *
 * - `none` — every leaf is per-turn; the reported usage IS the turn's spend.
 * - `cost` — token leaves are per-turn, `totalCostUsd` is a session total.
 * - `all` — every leaf is a session total.
 */
export type CumulativeUsageScope = "none" | "cost" | "all";

/**
 * Per-provider reporting shape. `none` is the default because it is the common
 * case, but it is an ASSUMPTION — and assuming it for Pi and OpenCode is what
 * produced the over-counting this module exists to fix. Answer this question
 * for any new provider (docs/subagent-accounting.md, per-provider checklist)
 * rather than letting it inherit the default silently.
 *
 * Claude is `none` because it de-cumulates at its own boundary: the SDK's
 * `total_cost_usd` is cumulative across one CLI process, and the provider
 * subtracts a watermark reset on each `system:init` before the manager sees it
 * (see docs/subagent-accounting.md).
 */
export function cumulativeUsageScopeFor(provider: AgentProvider): CumulativeUsageScope {
  switch (provider) {
    // Pi's session stats ARE the lifetime figures — tokens and cost alike.
    case "pi":
      return "all";
    // OpenCode resets its per-turn usage accumulator at each turn boundary, but
    // seeds `totalCostUsd` from `sessionTotalCostUsd`, which only ever grows.
    case "opencode":
      return "cost";
    default:
      return "none";
  }
}

/** The billable leaves, and the only ones a watermark ever covers. Context
 * window occupancy is absolute by nature and is never differenced. */
const TOKEN_FIELDS = [
  "inputTokens",
  "cachedInputTokens",
  "cacheCreationInputTokens",
  "outputTokens",
  "compactionInputTokens",
  "compactionOutputTokens",
] as const;

type TokenField = (typeof TOKEN_FIELDS)[number];

/**
 * The highest figure a cumulative-reporting provider has reported so far, per
 * leaf. Monotonic: a provider that reports a smaller number (a session reset, a
 * re-attach that lost history) never produces a negative delta.
 */
export interface TurnUsageWatermark {
  tokens?: Partial<Record<TokenField, number>>;
  costUsd?: number;
}

function finite(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export interface TurnSpend {
  /** This turn's spend — safe to add to any running total. */
  usage: AgentUsage | undefined;
  /** The watermark to carry into the next turn (unchanged for `none`). */
  watermark: TurnUsageWatermark | undefined;
}

/**
 * Normalize a provider's reported usage into THIS TURN's spend.
 *
 * For a per-turn reporter this is the identity. For a cumulative reporter each
 * covered leaf becomes `reported − watermark` (clamped at 0) and the watermark
 * advances to the running maximum.
 *
 * Leaves outside the cumulative scope, and the absolute context-window leaves,
 * pass through untouched — `usage` keeps its full shape so callers that read
 * occupancy off the same object are unaffected.
 *
 * First observation caveat: a watermark starts empty, so the first report after
 * a daemon restart books the provider's whole session total at once. That
 * matches how the lifetime total behaves anyway (it is ephemeral and resets with
 * the daemon), and over-booking once beats re-booking every turn.
 */
export function toTurnSpend(
  usage: AgentUsage | undefined,
  provider: AgentProvider,
  watermark: TurnUsageWatermark | undefined,
): TurnSpend {
  if (!usage) {
    return { usage: undefined, watermark };
  }
  const scope = cumulativeUsageScopeFor(provider);
  if (scope === "none") {
    return { usage, watermark };
  }

  const spend: AgentUsage = { ...usage };
  const next: TurnUsageWatermark = {
    ...(watermark?.tokens ? { tokens: { ...watermark.tokens } } : {}),
    ...(watermark?.costUsd !== undefined ? { costUsd: watermark.costUsd } : {}),
  };

  if (scope === "all") {
    for (const field of TOKEN_FIELDS) {
      const reported = finite(usage[field]);
      if (reported === undefined) {
        continue;
      }
      const seen = next.tokens?.[field] ?? 0;
      spend[field] = Math.max(0, reported - seen);
      next.tokens = { ...next.tokens, [field]: Math.max(seen, reported) };
    }
  }

  const reportedCost = finite(usage.totalCostUsd);
  if (reportedCost !== undefined) {
    const seenCost = next.costUsd ?? 0;
    spend.totalCostUsd = Math.max(0, reportedCost - seenCost);
    next.costUsd = Math.max(seenCost, reportedCost);
  }

  return { usage: spend, watermark: next };
}

/**
 * An agent's lifetime spend, kept as the real split rather than one scalar so
 * the cache-read share stays visible and the cost stays the provider's own.
 *
 * `costUsd` is the sum of the cost ACTUALLY BOOKED for this agent — which for a
 * parent chat is the de-inflated residual, not the raw whole-tree figure. That
 * is what makes `parent + Σ descendants` exact by construction rather than a
 * number that double-counts every sub-agent (see docs/subagent-accounting.md,
 * "Pricing invariant").
 */
export interface AgentLifetimeUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
  /** Provider-reported cost booked so far. Absent ⇒ nothing priceable yet. */
  costUsd?: number;
  /** Turns that contributed tokens. Denominator for cost coverage. */
  turns: number;
  /** Turns that contributed a real cost. `< turns` ⇒ the cost is a FLOOR. */
  costedTurns: number;
}

/** Every input class plus output — the same grand total `grandTotalTokens`
 * produces for an observed sub-agent, so a native row reads identically. */
export function lifetimeUsageTotalTokens(usage: AgentLifetimeUsage): number {
  return (
    usage.inputTokens +
    usage.cachedInputTokens +
    usage.cacheCreationInputTokens +
    usage.outputTokens
  );
}

/**
 * How much of this agent's token spend carries a real, provider-reported cost.
 *
 * - `complete` — every token-bearing turn was priced; the $ figure is the total.
 * - `partial` — some turns were not priced; the $ figure is a FLOOR and must be
 *   presented as one ("at least $X"), never as the total.
 * - `none` — nothing was priceable. Show tokens and an honest blank; do NOT
 *   estimate from a rate table.
 */
export type CostCoverage = "complete" | "partial" | "none";

export function costCoverageOf(usage: AgentLifetimeUsage): CostCoverage {
  if (usage.costedTurns <= 0 || usage.costUsd === undefined) {
    return "none";
  }
  return usage.costedTurns >= usage.turns ? "complete" : "partial";
}

/** The four billable token leaves, defaulted to 0. Shared by both builders
 * below so a leaf can never be read one way in one and another way in the
 * other. */
function readTokenSplit(usage: AgentUsage | undefined): {
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
  total: number;
} {
  const inputTokens = finite(usage?.inputTokens) ?? 0;
  const cachedInputTokens = finite(usage?.cachedInputTokens) ?? 0;
  const cacheCreationInputTokens = finite(usage?.cacheCreationInputTokens) ?? 0;
  const outputTokens = finite(usage?.outputTokens) ?? 0;
  return {
    inputTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    outputTokens,
    total: inputTokens + cachedInputTokens + cacheCreationInputTokens + outputTokens,
  };
}

/**
 * Fold one turn's spend into the running lifetime figures. `costMicroUsd` is
 * the cost the manager actually booked for this turn (residual-adjusted for a
 * parent chat), passed in rather than read off `usage` so the lifetime cost and
 * the itemized ledger can never disagree.
 */
export function accumulateLifetimeUsage(
  existing: AgentLifetimeUsage | undefined,
  usage: AgentUsage | undefined,
  costMicroUsd: number | undefined,
): AgentLifetimeUsage | undefined {
  const split = readTokenSplit(usage);
  const turnCostUsd = costMicroUsd !== undefined && costMicroUsd > 0 ? costMicroUsd / 1_000_000 : 0;
  if (split.total <= 0 && turnCostUsd <= 0) {
    return existing;
  }

  const prior = existing ?? {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 0,
    turns: 0,
    costedTurns: 0,
  };
  const next: AgentLifetimeUsage = {
    inputTokens: prior.inputTokens + split.inputTokens,
    cachedInputTokens: prior.cachedInputTokens + split.cachedInputTokens,
    cacheCreationInputTokens: prior.cacheCreationInputTokens + split.cacheCreationInputTokens,
    outputTokens: prior.outputTokens + split.outputTokens,
    // A turn with no tokens but a real cost (a residual drained onto an
    // otherwise-empty turn) still counts as priced, so coverage stays honest.
    turns: prior.turns + (split.total > 0 ? 1 : 0),
    costedTurns: prior.costedTurns + (turnCostUsd > 0 ? 1 : 0),
  };
  const costUsd = (prior.costUsd ?? 0) + turnCostUsd;
  if (costUsd > 0) {
    next.costUsd = costUsd;
  }
  return next;
}

/**
 * Build the lifetime figures for an OBSERVED sub-agent, whose carried-forward
 * `usage` is already its own running total (the accumulator sums across its
 * messages). No differencing: this is a projection, not an accumulation.
 *
 * Coverage is binary here — an observed row reports one settled usage object,
 * so it is either priced or it is not.
 */
export function observedLifetimeUsage(
  usage: AgentUsage | undefined,
): AgentLifetimeUsage | undefined {
  if (!usage) {
    return undefined;
  }
  const { total, ...split } = readTokenSplit(usage);
  if (total <= 0) {
    return undefined;
  }
  const costUsd = finite(usage.totalCostUsd);
  return {
    ...split,
    ...(costUsd !== undefined ? { costUsd } : {}),
    turns: 1,
    costedTurns: costUsd !== undefined ? 1 : 0,
  };
}
