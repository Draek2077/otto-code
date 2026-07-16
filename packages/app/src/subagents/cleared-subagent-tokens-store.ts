import { create } from "zustand";

/**
 * Per-parent tally of `cumulativeTokens` from sub-agent rows that have been
 * cleared (archived) out of a chat's sub-agents track — by the manual "Clear all
 * completed" gesture or the auto-clear driver. Archiving drops a row from the
 * track, which would silently drop its tokens from the header's honest fan-out
 * total (`formatHeaderLabel` sums only in-track rows). We roll each cleared row's
 * tokens in here first so the header total survives the clear.
 *
 * In-memory only, matching the daemon's `cumulativeTokens` accumulator, which is
 * itself ephemeral (resets on daemon restart — see docs/agent-lifecycle.md). This
 * tally resets on app reload; that is consistent with the metric it preserves.
 * The planned per-chat total (projects/total-token-accounting) can read the same
 * tally so cleared descendants keep counting toward the chat total.
 *
 * Recording is idempotent per agent id: an id is counted at most once, so a
 * retried clear (or a late re-emission) can never double-count.
 */
interface ClearedParentEntry {
  total: number;
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
      }
      if (!changed) {
        return state;
      }
      const byParent = new Map(state.byParent);
      byParent.set(key, { total, countedIds });
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
