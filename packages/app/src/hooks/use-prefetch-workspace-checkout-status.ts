import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchCheckoutStatus } from "@/git/checkout-status-cache";
import { checkoutStatusQueryKey } from "@/git/query-keys";
import { getHostRuntimeStore } from "@/runtime/host-runtime";

/**
 * Returns a callback that warms the checkout-status query for a workspace.
 * Wired to sidebar-row hover so the workspace header renders without its
 * skeleton on the first visit: the real query uses staleTime Infinity, so a
 * successful prefetch is served straight from cache at mount. prefetchQuery
 * dedupes in-flight fetches and skips fresh cache entries, so repeated hovers
 * are free.
 */
export function usePrefetchWorkspaceCheckoutStatus(): (input: {
  serverId: string;
  workspaceDirectory: string | null | undefined;
}) => void {
  const queryClient = useQueryClient();
  return useCallback(
    (input: { serverId: string; workspaceDirectory: string | null | undefined }) => {
      const cwd = input.workspaceDirectory?.trim();
      if (!cwd) {
        return;
      }
      const client = getHostRuntimeStore().getClient(input.serverId);
      if (!client) {
        return;
      }
      void queryClient.prefetchQuery({
        queryKey: checkoutStatusQueryKey(input.serverId, cwd),
        queryFn: () => fetchCheckoutStatus({ client, serverId: input.serverId, cwd }),
        staleTime: Infinity,
      });
    },
    [queryClient],
  );
}
