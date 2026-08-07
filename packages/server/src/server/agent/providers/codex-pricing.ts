// Published OpenAI Codex rate-card prices, used only by the Codex provider to
// attach a dollar cost to its own token usage. Keep this provider-bound: an
// OpenAI-compatible endpoint may serve a GPT-named model at different prices.
// Source: https://help.openai.com/en/articles/20001106 (2026-08-06).

import type { AgentUsage } from "../agent-sdk-types.js";

/** USD per million tokens for the three billable Codex token classes. */
export interface CodexModelRates {
  inputPerMTok: number;
  cachedInputPerMTok: number;
  outputPerMTok: number;
}

function rates(input: number, output: number): CodexModelRates {
  return { inputPerMTok: input, cachedInputPerMTok: input * 0.1, outputPerMTok: output };
}

// Exact Codex model id (lowercased) to price card. An unknown or preview-only
// model deliberately remains unpriced.
const CODEX_MODEL_RATES: Readonly<Record<string, CodexModelRates>> = {
  "gpt-5.6-sol": rates(5, 30),
  "gpt-5.6-terra": rates(2, 12),
  "gpt-5.6-luna": rates(0.2, 1.2),
  "gpt-5.5": rates(5, 30),
  "gpt-5.5-cyber": rates(12.5, 75),
  "gpt-5.4": rates(2.5, 15),
  "gpt-5.4-mini": rates(0.75, 4.5),
  "gpt-5.3-codex": rates(1.75, 14),
  "gpt-5.2": rates(1.75, 14),
};

/** The published price card for a Codex model, if it is a priced model. */
export function codexModelRates(model: string | undefined): CodexModelRates | undefined {
  return model ? CODEX_MODEL_RATES[model.trim().toLowerCase()] : undefined;
}

/**
 * Price one Codex request from its disjoint token split. Codex does not charge
 * cache writes, and `toAgentUsage` has already removed cached input from fresh
 * input, so these three leaves can be multiplied independently.
 */
export function priceCodexUsageUsd(
  usage: Pick<AgentUsage, "inputTokens" | "cachedInputTokens" | "outputTokens">,
  model: string | undefined,
): number | undefined {
  const card = codexModelRates(model);
  if (!card) return undefined;
  return (
    ((usage.inputTokens ?? 0) * card.inputPerMTok +
      (usage.cachedInputTokens ?? 0) * card.cachedInputPerMTok +
      (usage.outputTokens ?? 0) * card.outputPerMTok) /
    1_000_000
  );
}
