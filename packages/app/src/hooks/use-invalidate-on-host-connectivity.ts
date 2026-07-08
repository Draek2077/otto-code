import { useEffect, useMemo } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";

/**
 * Invalidate a query subtree whenever any host's connection status changes.
 *
 * This replaces folding the runtime version counter into the queryKey. The
 * version bumps on every runtime tick (agent-directory sync transitions
 * included), so keying on it minted a brand-new cache entry — and a full
 * refetch across all hosts — several times a minute. Connection transitions
 * are the only runtime change the aggregated host queries actually depend on:
 * a host coming online must trigger a refetch so its rows appear (including on
 * a cold deep-link), and one going offline must surface its host error.
 */
export function useInvalidateOnHostConnectivityChange(queryKey: QueryKey): void {
  const queryClient = useQueryClient();
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);

  useEffect(() => {
    const runtime = getHostRuntimeStore();
    const statuses = new Map<string, string>();
    for (const serverId of serverIds) {
      statuses.set(serverId, runtime.getSnapshot(serverId)?.connectionStatus ?? "unknown");
    }
    return runtime.subscribeAll(() => {
      let changed = false;
      for (const serverId of serverIds) {
        const status = runtime.getSnapshot(serverId)?.connectionStatus ?? "unknown";
        if (statuses.get(serverId) !== status) {
          statuses.set(serverId, status);
          changed = true;
        }
      }
      if (changed) {
        void queryClient.invalidateQueries({ queryKey });
      }
    });
  }, [queryClient, queryKey, serverIds]);
}
