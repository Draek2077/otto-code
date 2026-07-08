import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { schedulesQueryBaseKey } from "@/query/host-aggregate-query-keys";
import {
  fetchAggregatedSchedules,
  type AggregatedSchedule,
  type ScheduleHostError,
  type ScheduleHostInput,
} from "@/schedules/aggregated-schedules";

export type { AggregatedSchedule, ScheduleHostError } from "@/schedules/aggregated-schedules";

export { schedulesQueryBaseKey } from "@/query/host-aggregate-query-keys";

// Cache identity for the host set. Connectivity-driven freshness (retrying as
// hosts connect, including on a cold deep-link) comes from the host runtime
// store invalidating this key on online-status flips (see
// invalidateHostAggregateQueries) — not from keying on the runtime version,
// which churned the cache on every runtime tick. The full-screen spinner
// flash is prevented by keepPreviousData plus the
// isInitialLoad(data === undefined) gate.
export function schedulesQueryKey(serverIds: readonly string[]) {
  return [...schedulesQueryBaseKey, [...serverIds].sort().join("|")] as const;
}

export interface UseSchedulesResult {
  schedules: AggregatedSchedule[];
  hostErrors: ScheduleHostError[];
  isInitialLoad: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
  isRefetching: boolean;
}

export function useSchedules(): UseSchedulesResult {
  const hosts = useHosts();
  const runtime = getHostRuntimeStore();
  const hostInputs = useMemo<ScheduleHostInput[]>(
    () => hosts.map((host) => ({ serverId: host.serverId, serverName: host.label })),
    [hosts],
  );

  const query = useQuery({
    queryKey: schedulesQueryKey(hostInputs.map((host) => host.serverId)),
    queryFn: () => fetchAggregatedSchedules({ hosts: hostInputs, runtime }),
    staleTime: 5_000,
    refetchOnMount: true,
    placeholderData: keepPreviousData,
  });

  return {
    schedules: query.data?.schedules ?? [],
    hostErrors: query.data?.hostErrors ?? [],
    isInitialLoad: query.isLoading && query.data === undefined,
    isError: query.isError,
    error: query.error,
    refetch: () => {
      void query.refetch();
    },
    isRefetching: query.isRefetching,
  };
}
