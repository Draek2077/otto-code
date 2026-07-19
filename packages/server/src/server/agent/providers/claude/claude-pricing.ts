// Published Anthropic list prices for Claude models, used to price a sub-agent's
// real token split into real dollars so each observed sub-agent row in the usage
// ledger carries its OWN cost (not a roll-up) and the parent can be de-inflated
// by exactly that amount. See [[subagent-real-accounting]] (block 5).
//
// Conventions, mirroring model-tiers.ts:
//   - EXACT model-id match only, NO name-pattern guessing. An id we don't ship a
//     rate for returns undefined ⇒ the caller attributes 0 and leaves that spend
//     on the parent residual. Never fabricate a number.
//   - Rates are USD per MILLION tokens, per token class. cache-read is 0.1× the
//     input rate; 5-minute cache-write is 1.25×.
//
// These are LIST prices and will drift as Anthropic changes pricing. They are not
// trusted blindly: verifyClaudeTreePricing() re-prices the turn's whole-tree token
// totals (from the SDK's own modelUsage) and compares to the SDK's costUSD, so a
// stale table surfaces as a logged warning instead of silently skewing the books —
// and because the parent is booked as the residual (total − Σ sub-agent), any
// table drift lands on the parent, never inflating the grand total.
//
// PROVIDER-BOUNDARY INVARIANT: only ever call these from code that KNOWS it is
// genuinely the Claude provider (the Claude agent + its watcher). NEVER dispatch
// pricing by model id from provider-neutral code — another provider (e.g. an
// OpenAI-compatible gateway or router) can legitimately serve a "claude-*" model
// id at entirely different prices, so keying Anthropic rates off the id alone
// would misprice it. The neutral core (agent/subagent-usage.ts, agent-manager's
// ledger + residual) stays pricing-free; each provider prices its own tree.

import type { SubagentUsageTotals } from "../../subagent-usage.js";

/** USD per million tokens, by token class, for one model. */
export interface ClaudeModelRates {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
}

function rates(input: number, output: number): ClaudeModelRates {
  // cache-read 0.1× input, 5-minute cache-write 1.25× input (Anthropic's fixed
  // multipliers) — derived so a rate change only needs the two headline numbers.
  return {
    inputPerMTok: input,
    outputPerMTok: output,
    cacheReadPerMTok: input * 0.1,
    cacheWritePerMTok: input * 1.25,
  };
}

// Exact model id (lowercased) → rates. Only the models we can price with
// confidence; everything else is deliberately absent (→ undefined).
const CLAUDE_MODEL_RATES: Readonly<Record<string, ClaudeModelRates>> = {
  // Opus 4.x — $15 in / $75 out.
  "claude-opus-4-8": rates(15, 75),
  "claude-opus-4-7": rates(15, 75),
  "claude-opus-4-6": rates(15, 75),
  // Sonnet — $3 in / $15 out (standard, ≤200K context).
  "claude-sonnet-5": rates(3, 15),
  "claude-sonnet-4-6": rates(3, 15),
  // Haiku 4.5 — $1 in / $5 out. Both the plain and the dated API id.
  "claude-haiku-4-5": rates(1, 5),
  "claude-haiku-4-5-20251001": rates(1, 5),
};

/** The rate card for a model, or undefined when we don't ship a price for it. */
export function claudeModelRates(model: string | undefined): ClaudeModelRates | undefined {
  if (!model) {
    return undefined;
  }
  return CLAUDE_MODEL_RATES[model.toLowerCase()];
}

/**
 * Price a real token split against a model's rate card. `inputTokens` is FRESH
 * (uncached) input — Anthropic's `input_tokens` already excludes cache — so the
 * three input classes are disjoint and summed at their own rates. Returns USD, or
 * undefined when the model isn't priceable (caller attributes 0).
 */
export function priceClaudeUsageUsd(
  usage: SubagentUsageTotals,
  model: string | undefined,
): number | undefined {
  const card = claudeModelRates(model);
  if (!card) {
    return undefined;
  }
  return (
    (usage.inputTokens * card.inputPerMTok +
      usage.cacheReadInputTokens * card.cacheReadPerMTok +
      usage.cacheCreationInputTokens * card.cacheWritePerMTok +
      usage.outputTokens * card.outputPerMTok) /
    1_000_000
  );
}

/** One model's slice of the SDK's whole-tree `modelUsage`, as we read it. */
export interface ClaudeModelUsageSlice {
  model: string;
  usage: SubagentUsageTotals;
  costUSD: number;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Read the SDK result's `modelUsage` (`Record<model, ModelUsage>`) into priced
 * slices for verifyClaudeTreePricing. Tolerant of unknown shapes (returns the
 * slices it can read); a slice with no positive tokens is dropped as noise.
 */
export function readClaudeModelUsageSlices(modelUsage: unknown): ClaudeModelUsageSlice[] {
  if (!modelUsage || typeof modelUsage !== "object") {
    return [];
  }
  const slices: ClaudeModelUsageSlice[] = [];
  for (const [model, raw] of Object.entries(modelUsage as Record<string, unknown>)) {
    if (!model || !raw || typeof raw !== "object") {
      continue;
    }
    const record = raw as Record<string, unknown>;
    const usage: SubagentUsageTotals = {
      inputTokens: readNumber(record.inputTokens),
      cacheReadInputTokens: readNumber(record.cacheReadInputTokens),
      cacheCreationInputTokens: readNumber(record.cacheCreationInputTokens),
      outputTokens: readNumber(record.outputTokens),
    };
    const total =
      usage.inputTokens +
      usage.cacheReadInputTokens +
      usage.cacheCreationInputTokens +
      usage.outputTokens;
    if (total <= 0) {
      continue;
    }
    slices.push({ model, usage, costUSD: readNumber(record.costUSD) });
  }
  return slices;
}

/** The outcome of checking our table against the SDK's own per-model costUSD. */
export interface ClaudeTreePricingVerification {
  /** Models we could price AND whose SDK cost we matched within tolerance. */
  ok: boolean;
  ourUsd: number;
  sdkUsd: number;
  /** Priceable models where |ours − SDK| exceeded the tolerance. */
  mismatches: Array<{ model: string; ourUsd: number; sdkUsd: number }>;
  /** Models present in modelUsage that we have no rate card for. */
  unpriced: string[];
}

/**
 * Re-price the turn's whole-tree per-model token totals with our table and
 * compare to the SDK's own `costUSD`, so table drift is caught and logged. Purely
 * diagnostic — the books are kept balanced by the parent-residual rule regardless.
 * `relativeTolerance` is a fraction (default 2%); a model matches when the
 * absolute delta is within tolerance OR within a 1e-4 USD floor (rounding noise).
 */
export function verifyClaudeTreePricing(
  slices: readonly ClaudeModelUsageSlice[],
  relativeTolerance = 0.02,
): ClaudeTreePricingVerification {
  let ourUsd = 0;
  let sdkUsd = 0;
  const mismatches: ClaudeTreePricingVerification["mismatches"] = [];
  const unpriced: string[] = [];
  for (const slice of slices) {
    const priced = priceClaudeUsageUsd(slice.usage, slice.model);
    sdkUsd += slice.costUSD;
    if (priced === undefined) {
      unpriced.push(slice.model);
      continue;
    }
    ourUsd += priced;
    const delta = Math.abs(priced - slice.costUSD);
    if (delta > 1e-4 && delta > slice.costUSD * relativeTolerance) {
      mismatches.push({ model: slice.model, ourUsd: priced, sdkUsd: slice.costUSD });
    }
  }
  return { ok: mismatches.length === 0, ourUsd, sdkUsd, mismatches, unpriced };
}
