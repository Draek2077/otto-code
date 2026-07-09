import type { QueryClient } from "@tanstack/react-query";

/**
 * Base keys of the queries that aggregate rows across all hosts (projects,
 * schedules, artifacts). They live here — not in their use-* hooks — so the
 * host runtime store can invalidate them without importing hook modules that
 * themselves import the runtime.
 */
export const projectsQueryKey = ["projects"] as const;
export const schedulesQueryBaseKey = ["schedules"] as const;
export const artifactsQueryBaseKey = ["artifacts"] as const;

/**
 * Invalidate every host-aggregated query. Called by the host runtime store
 * whenever a host's online status flips, so the invalidation can never miss a
 * transition — component-mounted listeners raced the connect on cold start
 * (the fetch read "connecting", the subscription only caught up after the host
 * was already online) and were absent entirely when no screen was mounted.
 * With the app-wide `refetchOnMount: false`, a cached pre-online empty result
 * would otherwise persist until an unrelated invalidation.
 */
export function invalidateHostAggregateQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: projectsQueryKey });
  void queryClient.invalidateQueries({ queryKey: schedulesQueryBaseKey });
  void queryClient.invalidateQueries({ queryKey: artifactsQueryBaseKey });
}
