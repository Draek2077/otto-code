import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import type { AgentCumulativeUsage } from "@otto-code/protocol/messages";
import { useSessionStore } from "@/stores/session-store";
import { isTrackDescendantOf } from "./select";
import { useClearedSubagentTotals } from "./cleared-subagent-tokens-store";

/**
 * THE chat total — defined once, here, and read by every surface that shows
 * "what this chat cost". Before this existed, four surfaces each showed a
 * different number and none of them was the whole chat: the Visualizer summed
 * context-window OCCUPANCY, the chat indicator showed the parent's occupancy
 * alone, and the sub-agents header summed children while excluding the parent.
 *
 * Two rules make it trustworthy, and both are load-bearing:
 *
 * 1. **Spend, never occupancy.** These are lifetime tokens billed, not how full
 *    a context window is. The two share no units and must never be mixed in one
 *    readout — see docs/glossary.md ("total tokens" vs "context").
 * 2. **Cost is reported, never estimated.** `costUsd` only ever sums figures a
 *    provider actually reported, already de-inflated daemon-side so a parent
 *    never carries what its sub-agents reported. Where a provider cannot price
 *    (local models, most OpenAI-compatible endpoints), the answer is a blank and
 *    `costCoverage` says why. A confident wrong number is worse than none — it
 *    is the thing that eroded trust in the old display.
 */
export interface ChatTotals {
  /** Every input class plus output, across the parent and everything under it. */
  tokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
  /** Σ of provider-reported cost. `null` ⇒ nothing here was priceable. */
  costUsd: number | null;
  /**
   * `complete` — everything that spent tokens was priced; `costUsd` is the total.
   * `partial` — some contributors were unpriced; `costUsd` is a FLOOR and must
   * be presented as one. `none` — nothing was priceable; show tokens only.
   */
  costCoverage: "complete" | "partial" | "none";
  /**
   * False when at least one contributor reported only a scalar total (an older
   * daemon, or a provider with no split). The token figure is still honest; the
   * in/cached/out breakdown is incomplete, so don't present it as exact.
   */
  hasSplit: boolean;
  /** Agents that contributed spend: the parent plus its track descendants. */
  agentCount: number;
}

export const EMPTY_CHAT_TOTALS: ChatTotals = {
  tokens: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  outputTokens: 0,
  costUsd: null,
  costCoverage: "none",
  hasSplit: true,
  agentCount: 0,
};

/** A mutable tally, so the fold below stays allocation-free per contributor. */
interface Tally {
  tokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Contributors that spent tokens — the denominator for cost coverage. */
  spenders: number;
  /** ...of which carried a real cost. */
  costed: number;
  /**
   * True once any contributor is itself only partially priced. Tracked
   * separately from the counts because such a contributor IS costed — its
   * figure is just a floor, and a floor anywhere makes the whole sum a floor.
   */
  anyPartial: boolean;
  hasSplit: boolean;
  agentCount: number;
}

function emptyTally(): Tally {
  return {
    tokens: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    spenders: 0,
    costed: 0,
    anyPartial: false,
    hasSplit: true,
    agentCount: 0,
  };
}

function positive(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Fold one contributor in. `cumulativeTokens` is the authoritative scalar (every
 * daemon reports it); `cumulativeUsage` adds the split and the cost when the
 * daemon is new enough to send it. A contributor with the scalar but no split
 * still counts its tokens — it just clears `hasSplit`, because a partial
 * breakdown presented as exact would be its own small lie.
 */
export function addChatContributor(
  tally: Tally,
  contributor: { cumulativeTokens?: number; cumulativeUsage?: AgentCumulativeUsage },
): Tally {
  const usage = contributor.cumulativeUsage;
  const inputTokens = positive(usage?.inputTokens);
  const cachedInputTokens = positive(usage?.cachedInputTokens);
  const cacheCreationInputTokens = positive(usage?.cacheCreationInputTokens);
  const outputTokens = positive(usage?.outputTokens);
  const splitTotal = inputTokens + cachedInputTokens + cacheCreationInputTokens + outputTokens;
  const scalarTotal = positive(contributor.cumulativeTokens);
  // Prefer the scalar: it is what every other surface shows, and the two agree
  // by construction. The split is additional detail, not a second source.
  const tokens = scalarTotal > 0 ? scalarTotal : splitTotal;
  if (tokens <= 0) {
    return tally;
  }

  tally.tokens += tokens;
  tally.inputTokens += inputTokens;
  tally.cachedInputTokens += cachedInputTokens;
  tally.cacheCreationInputTokens += cacheCreationInputTokens;
  tally.outputTokens += outputTokens;
  tally.agentCount += 1;
  tally.spenders += 1;
  if (splitTotal <= 0) {
    tally.hasSplit = false;
  }

  const costUsd = positive(usage?.costUsd);
  if (costUsd > 0) {
    tally.costUsd += costUsd;
    tally.costed += 1;
  }
  // A contributor the daemon marked partially-priced drags the whole total to a
  // floor, even if every other contributor was fully priced.
  if (usage?.costCoverage === "partial") {
    tally.anyPartial = true;
  }
  return tally;
}

function finalize(tally: Tally): ChatTotals {
  if (tally.tokens <= 0 && tally.costUsd <= 0) {
    return EMPTY_CHAT_TOTALS;
  }
  let costCoverage: ChatTotals["costCoverage"] = "none";
  if (tally.costUsd > 0) {
    costCoverage = !tally.anyPartial && tally.costed >= tally.spenders ? "complete" : "partial";
  }
  return {
    tokens: tally.tokens,
    inputTokens: tally.inputTokens,
    cachedInputTokens: tally.cachedInputTokens,
    cacheCreationInputTokens: tally.cacheCreationInputTokens,
    outputTokens: tally.outputTokens,
    costUsd: tally.costUsd > 0 ? tally.costUsd : null,
    costCoverage,
    hasSplit: tally.hasSplit,
    agentCount: tally.agentCount,
  };
}

type SessionStoreSnapshot = ReturnType<typeof useSessionStore.getState>;

export interface ChatTotalsParams {
  serverId: string;
  /** The chat's own agent id. Its descendants are found by walking parents. */
  agentId: string;
}

/**
 * Totals for one chat and everything spawned under it — the parent plus the
 * same descendant set the sub-agents track shows (observed fan-out at any
 * depth; an attended child breaks the chain because it is its own chat with its
 * own total).
 *
 * `clearedTokens` covers rows already archived out of the track, so the honest
 * fan-out spend survives a "Clear all completed" instead of silently shrinking
 * the chat's total.
 */
export function selectChatTotals(
  state: SessionStoreSnapshot,
  params: ChatTotalsParams,
  cleared?: { tokens: number; costUsd: number },
): ChatTotals {
  const agents = state.sessions[params.serverId]?.agents;
  if (!agents || agents.size === 0) {
    return EMPTY_CHAT_TOTALS;
  }
  const tally = emptyTally();

  const parent = agents.get(params.agentId);
  if (parent) {
    addChatContributor(tally, parent);
  }
  for (const agent of agents.values()) {
    // Archived descendants are excluded here and accounted for through
    // `cleared` instead — counting both would double-count the same spend.
    if (agent.archivedAt || !isTrackDescendantOf(agent, params.agentId, agents)) {
      continue;
    }
    addChatContributor(tally, agent);
  }

  const clearedTokens = positive(cleared?.tokens);
  if (clearedTokens > 0) {
    tally.tokens += clearedTokens;
    // Cleared rows are carried as a scalar tally, so the split can't be exact.
    tally.hasSplit = false;
    tally.spenders += 1;
    const clearedCost = positive(cleared?.costUsd);
    if (clearedCost > 0) {
      tally.costUsd += clearedCost;
      tally.costed += 1;
    }
  }

  return finalize(tally);
}

/** Reactive {@link selectChatTotals}. */
export function useChatTotals(params: ChatTotalsParams): ChatTotals {
  const cleared = useClearedSubagentTotals(params.serverId, params.agentId);
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectChatTotals(state, params, cleared),
    equal,
  );
}

export type { Tally as ChatTotalsTally };
export { emptyTally as createChatTotalsTally, finalize as finalizeChatTotals };
