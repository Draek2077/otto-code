import type { QueryClient } from "@tanstack/react-query";
import type { Run } from "@otto-code/protocol/orchestration";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";

// Query keys + cache helpers for the daemon-owned orchestration Runs replica.
// The initial full list is fetched once (getRunsSnapshot) and then kept fresh by
// runs.updated.notification pushes, which upsert a single run by id (see
// applyRunUpdate, wired in data/push-router.ts).

export function runsQueryRoot(serverId: string): readonly unknown[] {
  return ["runs", serverId];
}

export function runsQueryKey(serverId: string): readonly unknown[] {
  return ["runs", serverId, "list"];
}

export type RunsSnapshotClient = Pick<DaemonClient, "getRunsSnapshot">;

export async function fetchRuns(input: { client: RunsSnapshotClient }): Promise<Run[]> {
  return input.client.getRunsSnapshot();
}

/**
 * Merge a single pushed run into the cached list by id. Intentionally a no-op
 * when the list hasn't been fetched yet: the replica query's initial fetch pulls
 * the full current snapshot, so dropping pre-fetch pushes avoids seeding a
 * partial list that would suppress that fetch.
 */
export function applyRunUpdate(input: {
  queryClient: QueryClient;
  serverId: string;
  run: Run;
}): void {
  const key = runsQueryKey(input.serverId);
  const existing = input.queryClient.getQueryData<Run[]>(key);
  if (!existing) {
    return;
  }
  const index = existing.findIndex((run) => run.id === input.run.id);
  if (index === -1) {
    input.queryClient.setQueryData<Run[]>(key, [...existing, input.run]);
    return;
  }
  const next = existing.slice();
  next[index] = input.run;
  input.queryClient.setQueryData<Run[]>(key, next);
}

/**
 * Drop pushed run ids from the cached list (runs.cleared.notification). A
 * no-op when the list hasn't been fetched yet, matching applyRunUpdate.
 */
export function applyRunsCleared(input: {
  queryClient: QueryClient;
  serverId: string;
  runIds: readonly string[];
}): void {
  const key = runsQueryKey(input.serverId);
  const existing = input.queryClient.getQueryData<Run[]>(key);
  if (!existing) {
    return;
  }
  const removed = new Set(input.runIds);
  input.queryClient.setQueryData<Run[]>(
    key,
    existing.filter((run) => !removed.has(run.id)),
  );
}
