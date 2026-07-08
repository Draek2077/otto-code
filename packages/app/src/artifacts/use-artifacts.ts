import { useEffect, useMemo, useSyncExternalStore } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { sortArtifacts } from "@/artifacts/artifact-derivation";
import {
  fetchAggregatedArtifacts,
  type AggregatedArtifact,
  type ArtifactHostError,
  type ArtifactHostInput,
} from "@/artifacts/aggregated-artifacts";

export type { AggregatedArtifact, ArtifactHostError } from "@/artifacts/aggregated-artifacts";

export const artifactsQueryBaseKey = ["artifacts"] as const;

// Cache identity for the host set + project filter. The query also carries the
// runtime version so it retries as connectivity changes and reliably fetches
// once a host comes online — matching the schedules pattern.
export function artifactsQueryKey(serverIds: readonly string[], projectId?: string) {
  return [...artifactsQueryBaseKey, [...serverIds].sort().join("|"), projectId ?? null] as const;
}

export interface UseArtifactsResult {
  artifacts: AggregatedArtifact[];
  hostErrors: ArtifactHostError[];
  isInitialLoad: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
  isRefetching: boolean;
}

export function useArtifacts(projectId?: string): UseArtifactsResult {
  const hosts = useHosts();
  const runtime = getHostRuntimeStore();
  const runtimeVersion = useSyncExternalStore(
    (onStoreChange) => runtime.subscribeAll(onStoreChange),
    () => runtime.getVersion(),
    () => runtime.getVersion(),
  );
  const hostInputs = useMemo<ArtifactHostInput[]>(
    () => hosts.map((host) => ({ serverId: host.serverId, serverName: host.label })),
    [hosts],
  );

  useArtifactNotifications();

  const query = useQuery({
    queryKey: [
      ...artifactsQueryKey(
        hostInputs.map((host) => host.serverId),
        projectId,
      ),
      runtimeVersion,
    ],
    queryFn: () => fetchAggregatedArtifacts({ hosts: hostInputs, projectId, runtime }),
    staleTime: 5_000,
    placeholderData: keepPreviousData,
  });

  const artifacts = useMemo(
    () => sortArtifacts(query.data?.artifacts ?? []),
    [query.data?.artifacts],
  );

  return {
    artifacts,
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

/**
 * Subscribe to daemon-pushed artifact notifications across all connected hosts
 * and invalidate the artifacts queries so the list re-syncs. Invalidation (over
 * hand-rolled optimistic writes) keeps the multi-host / multi-project cache
 * permutations correct without duplicating merge/sort logic.
 */
export function useArtifactNotifications(): void {
  const hosts = useHosts();
  const runtime = getHostRuntimeStore();
  const queryClient = useQueryClient();
  const runtimeVersion = useSyncExternalStore(
    (onStoreChange) => runtime.subscribeAll(onStoreChange),
    () => runtime.getVersion(),
    () => runtime.getVersion(),
  );

  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);

  useEffect(() => {
    const unsubscribes: Array<() => void> = [];
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: artifactsQueryBaseKey });
    };
    for (const serverId of serverIds) {
      const client = runtime.getClient(serverId);
      if (!client) {
        continue;
      }
      unsubscribes.push(client.on("artifact.created.notification", invalidate));
      unsubscribes.push(client.on("artifact.updated.notification", invalidate));
      unsubscribes.push(client.on("artifact.deleted.notification", invalidate));
    }
    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
    // runtimeVersion re-binds listeners when a host (re)connects.
  }, [serverIds, runtime, queryClient, runtimeVersion]);
}
