// Claude-SPECIFIC glue between Anthropic's wire usage and the provider-neutral
// sub-agent accounting core (../../subagent-usage.ts). Everything provider-shaped
// lives here: reading Anthropic's `usage` field names, and pricing on Claude's
// rate card. The neutral core (accumulator, totals, AgentUsage bridge) knows none
// of this — that's the boundary other providers implement their own version of to
// reach the same level of support. See [[subagent-real-accounting]].

import type { AgentUsage } from "../../agent-sdk-types.js";
import { type SubagentUsageTotals, subagentUsageToAgentUsage } from "../../subagent-usage.js";

import { priceClaudeUsageUsd } from "./claude-pricing.js";

function readNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Read the neutral split off a raw Anthropic `usage` object (BetaUsage on the
 * live stream, or its persisted JSONL twin) — the Claude-specific field mapping.
 * Gated on a numeric `output_tokens` (every real assistant frame carries one,
 * message_start included) so non-usage shapes are skipped. Missing fields read 0.
 */
export function readUsageTotals(usage: unknown): SubagentUsageTotals | undefined {
  if (!usage || typeof usage !== "object") {
    return undefined;
  }
  const u = usage as Record<string, unknown>;
  if (typeof u.output_tokens !== "number" || !Number.isFinite(u.output_tokens)) {
    return undefined;
  }
  return {
    inputTokens: readNonNegative(u.input_tokens),
    cacheReadInputTokens: readNonNegative(u.cache_read_input_tokens),
    cacheCreationInputTokens: readNonNegative(u.cache_creation_input_tokens),
    outputTokens: readNonNegative(u.output_tokens),
  };
}

/**
 * The Claude wire-usage for an observed sub-agent: the neutral split plus a real
 * cost priced on the sub-agent's OWN model (never the parent's). Cost is omitted
 * when the model isn't priceable, so the ledger shows an honest blank and that
 * spend stays on the parent residual. This is the ONLY place Claude pricing meets
 * the neutral AgentUsage — other providers write their own equivalent.
 */
export function toClaudeSubagentUsage(
  totals: SubagentUsageTotals,
  model: string | undefined,
): AgentUsage {
  const usage = subagentUsageToAgentUsage(totals);
  const costUsd = priceClaudeUsageUsd(totals, model);
  if (costUsd !== undefined) {
    usage.totalCostUsd = costUsd;
  }
  return usage;
}
