import { useEffect, useRef, useState } from "react";
import { useToast } from "@/contexts/toast-context";
import { useArchiveAgent, usePendingArchiveAgentIds } from "@/hooks/use-archive-agent";
import { toErrorMessage } from "@/utils/error-messages";
import { clearCompletedSubagents } from "./clear-completed-subagents";
import { useClearedSubagentTokensStore } from "./cleared-subagent-tokens-store";
import type { SubagentRow } from "./select";
import {
  isSubagentRowTidyEligible,
  selectSubagentsToAutoClear,
  SUBAGENT_AUTO_CLEAR_SETTLE_MS,
} from "./track-presentation";

export interface UseAutoClearCompletedSubagentsInput {
  serverId: string;
  parentAgentId: string;
  rows: readonly SubagentRow[];
  enabled: boolean;
}

/**
 * Device-local "auto-clear completed sub-agents" behavior for one chat's track.
 * When enabled, completed rows archive themselves once settled — no manual "Clear
 * all completed" needed — with their tokens rolled into the parent tally first so
 * the header total stays honest (see cleared-subagent-tokens-store.ts). Renders
 * nothing; mounted alongside the track in the agent panel.
 *
 * Scope is a chat's sub-agents track only (root chats are untouched), and it only
 * runs while the panel is mounted — decluttering matters where the track is
 * visible. Settled rows that fail to archive are not retried automatically (the
 * manual clear stays available), so a persistent failure can't spin.
 */
export function useAutoClearCompletedSubagents(input: UseAutoClearCompletedSubagentsInput): void {
  const { serverId, parentAgentId, rows, enabled } = input;
  const { archiveAgent } = useArchiveAgent();
  const pendingIds = usePendingArchiveAgentIds(serverId);
  const recordCleared = useClearedSubagentTokensStore((state) => state.recordCleared);
  const toast = useToast();

  // Ids we've already issued an auto-archive for — never retried, so a stuck
  // archive can't loop the effect. Reset when auto-clear is turned off.
  const attemptedRef = useRef<Set<string>>(new Set());
  // Bumped by the settle timer to re-evaluate rows that weren't settled yet.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) {
      attemptedRef.current = new Set();
      return;
    }

    const excludeIds = new Set<string>(pendingIds);
    for (const id of attemptedRef.current) {
      excludeIds.add(id);
    }

    const now = Date.now();
    const due = selectSubagentsToAutoClear(rows, {
      settleMs: SUBAGENT_AUTO_CLEAR_SETTLE_MS,
      now,
      excludeIds,
    });

    if (due.length > 0) {
      for (const row of due) {
        attemptedRef.current.add(row.id);
      }
      void clearCompletedSubagents(
        {
          serverId,
          parentAgentId,
          rows: due.map((row) => ({ id: row.id, cumulativeTokens: row.cumulativeTokens })),
        },
        {
          archiveAgent,
          recordCleared,
          reportError: (error) => toast.error(toErrorMessage(error)),
        },
      );
    }

    // Schedule a re-check for the soonest completed row that isn't settled yet.
    let earliestRemaining = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      if (!isSubagentRowTidyEligible(row) || excludeIds.has(row.id)) {
        continue;
      }
      const remaining = SUBAGENT_AUTO_CLEAR_SETTLE_MS - (now - row.updatedAt.getTime());
      if (remaining > 0 && remaining < earliestRemaining) {
        earliestRemaining = remaining;
      }
    }
    if (earliestRemaining === Number.POSITIVE_INFINITY) {
      return;
    }
    const timer = setTimeout(() => setTick((value) => value + 1), earliestRemaining + 50);
    return () => clearTimeout(timer);
  }, [
    enabled,
    rows,
    pendingIds,
    tick,
    serverId,
    parentAgentId,
    archiveAgent,
    recordCleared,
    toast,
  ]);
}
