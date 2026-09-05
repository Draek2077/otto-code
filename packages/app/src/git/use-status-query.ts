import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { checkoutStatusQueryKey } from "@/git/query-keys";
import { fetchCheckoutStatus } from "./checkout-status-cache";

export type { CheckoutStatusPayload } from "./checkout-status-cache";

export const CHECKOUT_STATUS_STALE_TIME = 15_000;

interface UseCheckoutStatusQueryOptions {
  serverId: string;
  cwd: string;
  /**
   * An action whose availability depends on the current working tree can ask
   * for one fresh snapshot when it mounts. Status is otherwise push-driven.
   */
  refreshOnMount?: boolean;
}

export function useCheckoutStatusQuery({
  serverId,
  cwd,
  refreshOnMount = false,
}: UseCheckoutStatusQueryOptions) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  const query = useQuery({
    queryKey: checkoutStatusQueryKey(serverId, cwd),
    queryFn: async () => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      return await fetchCheckoutStatus({ client, serverId, cwd });
    },
    enabled: !!client && isConnected && !!cwd,
    staleTime: Infinity,
    // Freshness is ordinarily push-driven (checkout_status_update applied
    // globally). `refreshOnMount` is reserved for UI affordances that need to
    // repair a missed push before deciding whether to render.
    refetchOnMount: refreshOnMount ? "always" : true,
    // Only bites when the query holds no successful data: `staleTime: Infinity`
    // makes a good status permanently fresh, so this costs nothing in the healthy
    // case. It is the recovery path for a workspace whose status measurement
    // failed while the pane stayed mounted (see fetchCheckoutStatus).
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
  });

  return {
    status: query.data ?? null,
    // `isLoading` drops between retries even though the first repository
    // measurement has not produced an answer yet. Keep consumers in their
    // loading state until that initial query settles, so a retryable discovery
    // failure never flashes a terminal "not a repository" message.
    isLoading: query.isPending,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
  };
}

/**
 * Subscribe to checkout status updates from the React Query cache without
 * initiating a fetch. Useful for list rows where a parent component prefetches
 * only the visible agents.
 */
export function useCheckoutStatusCacheOnly({ serverId, cwd }: UseCheckoutStatusQueryOptions) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);

  return useQuery({
    queryKey: checkoutStatusQueryKey(serverId, cwd),
    queryFn: async () => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      return await fetchCheckoutStatus({ client, serverId, cwd });
    },
    enabled: false,
    staleTime: CHECKOUT_STATUS_STALE_TIME,
  });
}
