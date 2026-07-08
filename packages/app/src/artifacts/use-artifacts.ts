import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { artifactBelongsToWorkspace, sortArtifacts } from "@/artifacts/artifact-derivation";
import { artifactsQueryBaseKey } from "@/query/host-aggregate-query-keys";
import {
  fetchAggregatedArtifacts,
  type AggregatedArtifact,
  type ArtifactHostError,
  type ArtifactHostInput,
  type FetchAggregatedArtifactsResult,
} from "@/artifacts/aggregated-artifacts";

export type { AggregatedArtifact, ArtifactHostError } from "@/artifacts/aggregated-artifacts";

export { artifactsQueryBaseKey } from "@/query/host-aggregate-query-keys";

// Cache identity for the host set + project filter. Freshness is event-driven:
// artifact CRUD notifications (useArtifactNotifications) and host online-status
// flips (invalidateHostAggregateQueries in the host runtime store) invalidate
// the key rather than the key itself churning.
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

function useArtifactHostInputs(): ArtifactHostInput[] {
  const hosts = useHosts();
  return useMemo<ArtifactHostInput[]>(
    () => hosts.map((host) => ({ serverId: host.serverId, serverName: host.label })),
    [hosts],
  );
}

export function useArtifacts(projectId?: string): UseArtifactsResult {
  const runtime = getHostRuntimeStore();
  const hostInputs = useArtifactHostInputs();

  useArtifactNotifications();

  const query = useQuery({
    queryKey: artifactsQueryKey(
      hostInputs.map((host) => host.serverId),
      projectId,
    ),
    queryFn: () => fetchAggregatedArtifacts({ hosts: hostInputs, projectId, runtime }),
    staleTime: 5_000,
    refetchOnMount: true,
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

const EMPTY_AGENT_IDS: string[] = [];

/**
 * Agent ids of artifacts currently generating in the given workspace on the
 * given host. Shares the app-wide artifacts query cache with useArtifacts but
 * selects down to a sorted id array, so subscribers (every mounted
 * WorkspaceScreen deck entry) only re-render when the id set actually changes
 * — which is almost never, since it is empty unless a generation is running.
 *
 * Freshness is event-driven (notifications + connectivity invalidation), so
 * the staleTime is long: switching workspaces should not fan out an all-hosts
 * artifacts fetch just to recompute an empty set.
 */
export function useGeneratingArtifactAgentIds(input: {
  serverId: string;
  workspaceDirectory: string | null;
}): Set<string> {
  const runtime = getHostRuntimeStore();
  const hostInputs = useArtifactHostInputs();

  useArtifactNotifications();

  const { serverId, workspaceDirectory } = input;
  const select = useCallback(
    (data: FetchAggregatedArtifactsResult) => {
      if (!workspaceDirectory) {
        return EMPTY_AGENT_IDS;
      }
      const ids: string[] = [];
      for (const artifact of data.artifacts) {
        if (
          artifact.serverId === serverId &&
          artifact.status === "generating" &&
          artifact.generationAgentId &&
          artifactBelongsToWorkspace(artifact.projectId, workspaceDirectory)
        ) {
          ids.push(artifact.generationAgentId);
        }
      }
      return ids.length > 0 ? ids.sort() : EMPTY_AGENT_IDS;
    },
    [serverId, workspaceDirectory],
  );

  const query = useQuery({
    queryKey: artifactsQueryKey(hostInputs.map((host) => host.serverId)),
    queryFn: () => fetchAggregatedArtifacts({ hosts: hostInputs, runtime }),
    staleTime: 60_000,
    select,
  });

  const ids = query.data ?? EMPTY_AGENT_IDS;
  return useMemo(() => new Set(ids), [ids]);
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
