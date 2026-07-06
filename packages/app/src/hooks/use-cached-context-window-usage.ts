import { useEffect, useMemo } from "react";
import {
  buildContextUsageCacheKey,
  useContextUsageCacheStore,
} from "@/stores/context-usage-cache-store";

export interface ContextWindowUsageValues {
  maxTokens: number | null;
  usedTokens: number | null;
  totalCostUsd: number | null;
}

/**
 * Falls back to the last cached context usage for this agent when live data
 * isn't available yet — e.g. right after an app restart, before the daemon
 * has resent fresh usage — and keeps the cache updated whenever live usage
 * arrives. Draft composers pass a stable tab id as `agentId` rather than a
 * real agent id, but since live data there is always null, nothing is ever
 * written under that key, so drafts never inherit a previous chat's usage.
 */
export function useCachedContextWindowUsage(
  serverId: string,
  agentId: string,
  live: ContextWindowUsageValues,
): ContextWindowUsageValues {
  const cacheKey = buildContextUsageCacheKey(serverId, agentId);
  const cached = useContextUsageCacheStore((state) => state.entries[cacheKey]);
  const { maxTokens, usedTokens, totalCostUsd } = live;

  useEffect(() => {
    if (maxTokens === null || usedTokens === null) {
      return;
    }
    useContextUsageCacheStore.getState().setUsage(cacheKey, {
      maxTokens,
      usedTokens,
      totalCostUsd,
      updatedAt: Date.now(),
    });
  }, [cacheKey, maxTokens, usedTokens, totalCostUsd]);

  return useMemo(() => {
    if (maxTokens !== null && usedTokens !== null) {
      return { maxTokens, usedTokens, totalCostUsd };
    }
    if (cached) {
      return {
        maxTokens: cached.maxTokens,
        usedTokens: cached.usedTokens,
        totalCostUsd: cached.totalCostUsd,
      };
    }
    return { maxTokens: null, usedTokens: null, totalCostUsd: null };
  }, [maxTokens, usedTokens, totalCostUsd, cached]);
}
