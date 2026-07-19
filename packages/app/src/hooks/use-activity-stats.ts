import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import type { ActivityCounters } from "@otto-code/protocol/messages";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { usageLogQueryKey } from "@/hooks/use-usage-log";

export const ACTIVITY_STATS_STALE_TIME_MS = 60 * 1000;

export interface ActivityStatsRollups {
  today: ActivityCounters;
  yesterday: ActivityCounters;
  last7Days: ActivityCounters;
  last30Days: ActivityCounters;
  allTime: ActivityCounters;
}

export type ActivityStatsView =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rollups: ActivityStatsRollups; isRefreshing: boolean };

type ActivityStatsClient = Pick<DaemonClient, "getActivityStats">;
type StatsResetClient = Pick<DaemonClient, "resetActivityStats">;

export function activityStatsQueryKey(serverId: string | null | undefined) {
  return ["activityStats", serverId ?? ""] as const;
}

/**
 * The single detection point for the activity-stats capability.
 * COMPAT(activityStats): added in v0.5.3, drop the gate when daemon floor >= v0.5.3.
 */
export function useActivityStatsFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.activityStats === true,
  );
}

/**
 * Detection point for the per-category usage & cost counters (WP-G). When false
 * (old daemon), the rollups still carry the base counters but every category
 * token/cost leaf is 0 — so the Usage & Cost column hides its category/cost grid
 * rather than presenting a column of zeros as if it were real accounting.
 * COMPAT(usageCostCategories): added in v0.6.4, drop the gate when daemon floor >= v0.6.4.
 */
export function useUsageCostCategoriesFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.usageCostCategories === true,
  );
}

/**
 * Detection point for the "Reset" capability — wiping all usage counters and
 * the itemized ledger. When false (old daemon with no handler), the Metrics
 * screen hides the Reset button rather than sending a request that would hang.
 * COMPAT(statsReset): added in v0.6.4, drop the gate when daemon floor >= v0.6.4.
 */
export function useStatsResetFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.statsReset === true,
  );
}

export type StatsResetView =
  | { kind: "unavailable" }
  | { kind: "ready"; reset: () => Promise<void>; isResetting: boolean };

/**
 * Imperative reset action for the Metrics screen. Sends stats.activity.reset,
 * then invalidates both the rollup and the usage-log queries so the tiles and
 * the Log tab re-fetch their now-empty state (the daemon also broadcasts
 * activity_stats_changed, but invalidating here makes the wipe feel instant and
 * covers the coalesce delay).
 */
export function useResetActivityStats(serverId: string | null | undefined): {
  reset: () => Promise<void>;
  canReset: boolean;
  isResetting: boolean;
} {
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId ?? "") as StatsResetClient | null;
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const supported = useStatsResetFeature(serverId ?? "");
  const [isResetting, setIsResetting] = useState(false);
  const canReset = Boolean(serverId && client && isConnected && supported);

  const reset = useCallback(async () => {
    if (!serverId || !client || !canReset) return;
    setIsResetting(true);
    try {
      await client.resetActivityStats();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: activityStatsQueryKey(serverId) }),
        queryClient.invalidateQueries({ queryKey: usageLogQueryKey(serverId) }),
      ]);
    } finally {
      setIsResetting(false);
    }
  }, [canReset, client, queryClient, serverId]);

  return { reset, canReset, isResetting };
}

async function fetchActivityStats(client: ActivityStatsClient): Promise<ActivityStatsRollups> {
  const payload = await client.getActivityStats();
  return {
    today: payload.today,
    yesterday: payload.yesterday,
    last7Days: payload.last7Days,
    last30Days: payload.last30Days,
    allTime: payload.allTime,
  };
}

export function useActivityStats(serverId: string | null | undefined): {
  view: ActivityStatsView;
  refresh: () => Promise<void>;
  canFetch: boolean;
} {
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const supported = useActivityStatsFeature(serverId ?? "");
  const queryKey = useMemo(() => activityStatsQueryKey(serverId), [serverId]);
  const canFetch = Boolean(serverId && client && isConnected && supported);

  const queryFn = useCallback(async () => {
    if (!client) {
      throw new Error("Host disconnected");
    }
    return fetchActivityStats(client);
  }, [client]);

  const query = useFetchQuery({
    queryKey,
    queryFn,
    enabled: canFetch,
    dataShape: "value",
    staleTimeMs: ACTIVITY_STATS_STALE_TIME_MS,
  });

  const refresh = useCallback(async () => {
    if (!canFetch) return;
    await queryClient.invalidateQueries({ queryKey });
    await queryClient.fetchQuery({ queryKey, queryFn });
  }, [canFetch, queryClient, queryFn, queryKey]);

  const view = useMemo<ActivityStatsView>(() => {
    if (!serverId || !client || !isConnected) {
      return { kind: "error", message: "Host unavailable." };
    }
    if (!supported) {
      return { kind: "error", message: "Update the host to see activity stats." };
    }
    if (query.data) {
      return { kind: "ready", rollups: query.data, isRefreshing: query.isFetching };
    }
    if (query.isError) {
      return {
        kind: "error",
        message: query.error instanceof Error ? query.error.message : String(query.error),
      };
    }
    return { kind: "loading" };
  }, [
    client,
    isConnected,
    query.data,
    query.error,
    query.isError,
    query.isFetching,
    serverId,
    supported,
  ]);

  return { view, refresh, canFetch };
}
