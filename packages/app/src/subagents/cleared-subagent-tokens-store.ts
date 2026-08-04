import equal from "fast-deep-equal";
import { create } from "zustand";
import { useStoreWithEqualityFn } from "zustand/traditional";

/**
 * Per-parent tally of `cumulativeTokens` from sub-agent rows that have been
 * cleared (archived) out of a chat's sub-agents track - by the manual "Clear all
 * completed" gesture or the auto-clear driver. Archiving drops a row from the
 * track, which would silently drop its tokens from the header's honest fan-out
 * total (`formatHeaderLabel` sums only in-track rows). We roll each cleared row's
 * tokens in here first so the header total survives the clear.
 *
 * In-memory only, matching the daemon's `cumulativeTokens` accumulator, which is
 * itself ephemeral (resets on daemon restart - see docs/agent-lifecycle.md). This
 * tally resets on app reload; that is consistent with the metric it preserves.
 * The planned per-chat total (projects/total-token-accounting) can read the same
 * tally so cleared descendants keep counting toward the chat total.
 *
 * Recording is idempotent per agent id: an id is counted at most once, so a
 * retried clear (or a late re-emission) can never double-count.
 */
interface ClearedParentEntry {
  total: number;
  /**
   * Provider-reported cost from the same cleared rows, so the chat total (see
   * chat-totals.ts) does not silently get cheaper when rows are tidied away.
   * Only ever a real reported figure - a row the provider could not price adds
   * tokens here and nothing to the cost.
   */
  costUsd: number;
  countedIds: Set<string>;
}

interface ClearedSubagentTokensState {
  byParent: ReadonlyMap<string, ClearedParentEntry>;
  recordCleared: (input: RecordClearedInput) => void;
  resetForParent: (input: { serverId: string; parentAgentId: string }) => void;
}

export interface ClearedSubagentTokensRow {
  id: string;
  cumulativeTokens?: number;
  cumulativeUsage?: { costUsd?: number };
}

export interface RecordClearedInput {
  serverId: string;
  parentAgentId: string;
  rows: readonly ClearedSubagentTokensRow[];
}

function parentKey(serverId: string, parentAgentId: string): string {
  return `${serverId}::${parentAgentId}`;
}

export const useClearedSubagentTokensStore = create<ClearedSubagentTokensState>((set) => ({
  byParent: new Map(),
  recordCleared: ({ serverId, parentAgentId, rows }) => {
    if (rows.length === 0) {
      return;
    }
    set((state) => {
      const key = parentKey(serverId, parentAgentId);
      const existing = state.byParent.get(key);
      const countedIds = new Set(existing?.countedIds);
      let total = existing?.total ?? 0;
      let costUsd = existing?.costUsd ?? 0;
      let changed = false;
      for (const row of rows) {
        if (countedIds.has(row.id)) {
          continue;
        }
        countedIds.add(row.id);
        changed = true;
        if (typeof row.cumulativeTokens === "number" && Number.isFinite(row.cumulativeTokens)) {
          total += Math.max(0, row.cumulativeTokens);
        }
        const rowCost = row.cumulativeUsage?.costUsd;
        if (typeof rowCost === "number" && Number.isFinite(rowCost)) {
          costUsd += Math.max(0, rowCost);
        }
      }
      if (!changed) {
        return state;
      }
      const byParent = new Map(state.byParent);
      byParent.set(key, { total, costUsd, countedIds });
      return { byParent };
    });
  },
  resetForParent: ({ serverId, parentAgentId }) => {
    set((state) => {
      const key = parentKey(serverId, parentAgentId);
      if (!state.byParent.has(key)) {
        return state;
      }
      const byParent = new Map(state.byParent);
      byParent.delete(key);
      return { byParent };
    });
  },
}));

/** Reactive selector: total cleared-sub-agent tokens for one parent's track. */
export function useClearedSubagentTokens(serverId: string, parentAgentId: string): number {
  return useClearedSubagentTokensStore(
    (state) => state.byParent.get(parentKey(serverId, parentAgentId))?.total ?? 0,
  );
}

export interface ClearedSubagentTotals {
  tokens: number;
  costUsd: number;
}

const NO_CLEARED_TOTALS: ClearedSubagentTotals = { tokens: 0, costUsd: 0 };

/**
 * Reactive tokens AND cost from cleared rows, for the chat total. Selects a
 * fresh object, so it needs a value-equality comparator - the default reference
 * check would re-render on every unrelated store write.
 */
export function useClearedSubagentTotals(
  serverId: string,
  parentAgentId: string,
): ClearedSubagentTotals {
  return useStoreWithEqualityFn(
    useClearedSubagentTokensStore,
    (state) => {
      const entry = state.byParent.get(parentKey(serverId, parentAgentId));
      if (!entry || (entry.total <= 0 && entry.costUsd <= 0)) {
        return NO_CLEARED_TOTALS;
      }
      return { tokens: entry.total, costUsd: entry.costUsd };
    },
    equal,
  );
}
