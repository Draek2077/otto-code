// Provider-AGNOSTIC token accounting for a single observed sub-agent.
//
// This is the neutral core every provider plugs into to give its sub-agents the
// same first-class accounting Claude has (the gold standard). A provider parses
// ITS OWN wire usage into the neutral SubagentUsageTotals, feeds each assistant
// frame to a SubagentUsageAccumulator, and hands the result to the daemon as a
// plain AgentUsage — after which the provider-neutral sink (agent-manager's
// observed-sub-agent recording + parent-residual de-inflation) does the rest,
// identically for every provider. Keep this module free of any provider's field
// names, model ids, or pricing: those live behind the provider boundary (for
// Claude: providers/claude/{claude-subagent-usage,claude-pricing}.ts).
//
// Why an accumulator at all: providers stream an assistant turn across several
// frames that share one message id, each repeating a usage block whose output
// grows to the turn's final value while input/cache stay constant. So the
// accounting is: keep the largest-output frame per message id (that final frame
// carries the message's complete, authoritative split), then sum across ids. No
// roll-up, no estimation — just the raw reported numbers, deduped. Providers that
// report one usage per turn (no mid-turn frames) still work: each id is seen once.
// See [[subagent-real-accounting]].

import type { AgentUsage } from "./agent-sdk-types.js";

/**
 * The four billable token counts for a sub-agent, summed across its turn(s).
 * Straight from the provider's reported usage — the raw numbers, so the cache
 * split is real (not derived). Field names are neutral; a provider maps its own
 * wire shape onto these (e.g. Claude's cache_read_input_tokens → cacheRead…).
 */
export interface SubagentUsageTotals {
  inputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
}

/** The sub-agent's grand token total: every input class plus output. Matches how
 * native agents roll up cumulativeTokens (sumTurnUsageTokens in agent-manager),
 * so an observed row reads the same as a real one. */
export function grandTotalTokens(totals: SubagentUsageTotals): number {
  return (
    totals.inputTokens +
    totals.cacheReadInputTokens +
    totals.cacheCreationInputTokens +
    totals.outputTokens
  );
}

/**
 * Bridge the neutral split onto the wire AgentUsage shape (cacheRead →
 * cachedInputTokens, cacheCreation → cacheCreationInputTokens). Deliberately
 * attaches NO cost: cost is provider-specific (real only where a provider reports
 * or can price it) and is set separately by the owning provider, so this stays
 * usable by every provider including token-only ones. See the Claude reference in
 * providers/claude/claude-subagent-usage.ts.
 */
export function subagentUsageToAgentUsage(totals: SubagentUsageTotals): AgentUsage {
  return {
    inputTokens: totals.inputTokens,
    cachedInputTokens: totals.cacheReadInputTokens,
    cacheCreationInputTokens: totals.cacheCreationInputTokens,
    outputTokens: totals.outputTokens,
  };
}

function positiveDelta(current: number | undefined, recorded: number | undefined): number {
  return Math.max(0, (current ?? 0) - (recorded ?? 0));
}

/**
 * The INCREMENTAL usage still owed to the ledger: `current` running totals minus
 * the `recorded` watermark (what was already written), per field, clamped at 0.
 * Returns undefined when nothing new accrued.
 *
 * A sub-agent's totals only ever grow, and it can settle more than once — it may
 * be continued/steered into a second stream under the same key, or a late frame
 * can raise its totals after it first settled. Recording the delta each time
 * keeps one row per stream (the same "one query, one row" rule chats follow)
 * instead of silently dropping everything after the first settle. Provider-
 * agnostic. See [[subagent-real-accounting]].
 */
export function deltaAgentUsage(
  current: AgentUsage,
  recorded: AgentUsage | undefined,
): AgentUsage | undefined {
  const inputTokens = positiveDelta(current.inputTokens, recorded?.inputTokens);
  const cachedInputTokens = positiveDelta(current.cachedInputTokens, recorded?.cachedInputTokens);
  const cacheCreationInputTokens = positiveDelta(
    current.cacheCreationInputTokens,
    recorded?.cacheCreationInputTokens,
  );
  const outputTokens = positiveDelta(current.outputTokens, recorded?.outputTokens);
  if (inputTokens + cachedInputTokens + cacheCreationInputTokens + outputTokens <= 0) {
    return undefined;
  }
  const delta: AgentUsage = {
    inputTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    outputTokens,
  };
  const totalCostUsd = positiveDelta(current.totalCostUsd, recorded?.totalCostUsd);
  if (totalCostUsd > 0) {
    delta.totalCostUsd = totalCostUsd;
  }
  return delta;
}

/**
 * Stateful per-sub-agent usage accumulator. Feed it each assistant frame's
 * message id / already-parsed usage split / model; it dedups by message id
 * (final streamed frame of a message wins), sums across messages, and remembers
 * the model (first seen — a sub-agent can run a different, cheaper model than its
 * parent, which matters for pricing). Provider-agnostic: the caller does the
 * provider-specific parsing before calling {@link observe}.
 */
export class SubagentUsageAccumulator {
  private readonly byMessageId = new Map<string, SubagentUsageTotals>();
  private modelId: string | undefined;

  /**
   * Observe one assistant frame. `usage` is the already-parsed split; `messageId`
   * is the provider's per-message id. A frame with no usage or no id still
   * contributes its model, so a model-only frame is not lost.
   */
  observe(input: {
    messageId: string | undefined;
    usage: SubagentUsageTotals | undefined;
    model: string | undefined;
  }): void {
    if (this.modelId === undefined && input.model) {
      this.modelId = input.model;
    }
    if (!input.usage || !input.messageId) {
      return;
    }
    const prior = this.byMessageId.get(input.messageId);
    // Replace on a larger output_tokens: the final streamed frame of a message
    // carries the authoritative in/out/cache values, so take that frame whole.
    if (!prior || input.usage.outputTokens > prior.outputTokens) {
      this.byMessageId.set(input.messageId, input.usage);
    }
  }

  /** The real token footprint so far — summed across deduped messages. */
  totals(): SubagentUsageTotals {
    const totals: SubagentUsageTotals = {
      inputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 0,
    };
    for (const usage of this.byMessageId.values()) {
      totals.inputTokens += usage.inputTokens;
      totals.cacheReadInputTokens += usage.cacheReadInputTokens;
      totals.cacheCreationInputTokens += usage.cacheCreationInputTokens;
      totals.outputTokens += usage.outputTokens;
    }
    return totals;
  }

  /** The model this sub-agent ran on (first seen), e.g. "claude-haiku-4-5-…". */
  model(): string | undefined {
    return this.modelId;
  }

  /**
   * How many distinct model round-trips this sub-agent has made so far (one per
   * deduped message id). Deliberately "rounds", not "turns": one user query is
   * one turn / one ledger row, while a sub-agent internally makes many rounds
   * inside its single row. Surfaced on the row because a big `cached` figure is
   * the SAME context re-read once per round — without the round count it reads
   * like a cache "size" rather than cumulative cache-reads.
   */
  roundCount(): number {
    return this.byMessageId.size;
  }

  /** True until the first usage-bearing frame is observed. */
  isEmpty(): boolean {
    return this.byMessageId.size === 0;
  }
}
