import type { QueryClient } from "@tanstack/react-query";
import type { OrchestrationGraph } from "@otto-code/protocol/orchestration";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";

// Query keys + cache helpers for the host-level orchestration Graph templates
// (projects/orchestration-graphs). Fetched once, then kept fresh by
// runs.graphs.changed.notification pushes, which carry the FULL list (graphs
// are few and small), so the cache is simply replaced — no per-id merging.

export function orchestrationGraphsQueryKey(serverId: string): readonly unknown[] {
  return ["orchestration-graphs", serverId, "list"];
}

export type OrchestrationGraphsClient = Pick<DaemonClient, "listOrchestrationGraphs">;

export async function fetchOrchestrationGraphs(input: {
  client: OrchestrationGraphsClient;
}): Promise<OrchestrationGraph[]> {
  return input.client.listOrchestrationGraphs();
}

/**
 * Replace the cached list with a pushed full snapshot. A no-op when the list
 * hasn't been fetched yet (matches applyRunUpdate's replica discipline).
 */
export function applyOrchestrationGraphsChanged(input: {
  queryClient: QueryClient;
  serverId: string;
  graphs: OrchestrationGraph[];
}): void {
  const key = orchestrationGraphsQueryKey(input.serverId);
  const existing = input.queryClient.getQueryData<OrchestrationGraph[]>(key);
  if (!existing) {
    return;
  }
  input.queryClient.setQueryData<OrchestrationGraph[]>(key, input.graphs);
}
