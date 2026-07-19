import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import type { UsageEvent } from "@otto-code/protocol/messages";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

export const USAGE_LOG_STALE_TIME_MS = 60 * 1000;

// One page is plenty for the "scroll recent activity" view; older rows are
// reachable via the daemon's `before` cursor, wired as a follow-up (usage-ledger).
const USAGE_LOG_PAGE_SIZE = 200;

export interface UsageLogData {
  events: UsageEvent[];
  hasMore: boolean;
}

export type UsageLogView =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: UsageLogData; isRefreshing: boolean };

type UsageLogClient = Pick<DaemonClient, "getUsageLog">;

export function usageLogQueryKey(serverId: string | null | undefined) {
  return ["usageLog", serverId ?? ""] as const;
}

/**
 * Detection point for the itemized usage ledger capability. When false (old
 * daemon), the Metrics screen simply doesn't offer the Log tab.
 * COMPAT(usageLog): added in v0.6.4, drop the gate when daemon floor >= v0.6.4.
 */
export function useUsageLogFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.usageLog === true,
  );
}

async function fetchUsageLog(client: UsageLogClient): Promise<UsageLogData> {
  const payload = await client.getUsageLog({ limit: USAGE_LOG_PAGE_SIZE });
  return { events: payload.events, hasMore: payload.hasMore };
}

export function useUsageLog(serverId: string | null | undefined): {
  view: UsageLogView;
  refresh: () => Promise<void>;
  canFetch: boolean;
} {
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const supported = useUsageLogFeature(serverId ?? "");
  const queryKey = useMemo(() => usageLogQueryKey(serverId), [serverId]);
  const canFetch = Boolean(serverId && client && isConnected && supported);

  const queryFn = useCallback(async () => {
    if (!client) {
      throw new Error("Host disconnected");
    }
    return fetchUsageLog(client);
  }, [client]);

  const query = useFetchQuery({
    queryKey,
    queryFn,
    enabled: canFetch,
    dataShape: "value",
    staleTimeMs: USAGE_LOG_STALE_TIME_MS,
  });

  const refresh = useCallback(async () => {
    if (!canFetch) return;
    await queryClient.invalidateQueries({ queryKey });
    await queryClient.fetchQuery({ queryKey, queryFn });
  }, [canFetch, queryClient, queryFn, queryKey]);

  const view = useMemo<UsageLogView>(() => {
    if (!serverId || !client || !isConnected) {
      return { kind: "error", message: "Host unavailable." };
    }
    if (!supported) {
      return { kind: "error", message: "Update the host to see the usage log." };
    }
    if (query.data) {
      return { kind: "ready", data: query.data, isRefreshing: query.isFetching };
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
