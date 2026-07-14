import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import type { ActivityCounters } from "@otto-code/protocol/messages";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

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
