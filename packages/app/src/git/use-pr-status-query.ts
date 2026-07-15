import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import {
  type CheckoutPrStatusResponse,
  normalizeGitHostingProviderId,
} from "@otto-code/protocol/messages";
import { checkoutPrStatusQueryKey } from "@/git/query-keys";
import { selectPrHintFromStatus, type PrHint } from "@/git/pr-hint";

interface UseCheckoutPrStatusQueryOptions {
  serverId: string;
  cwd: string;
  enabled?: boolean;
}

export type CheckoutPrStatusPayload = CheckoutPrStatusResponse["payload"];
export { selectPrHintFromStatus, type PrHint } from "@/git/pr-hint";

function selectWorkspacePrHint(payload: CheckoutPrStatusPayload): PrHint | null {
  return selectPrHintFromStatus(payload.status);
}

export function useCheckoutPrStatusQuery({
  serverId,
  cwd,
  enabled = true,
}: UseCheckoutPrStatusQueryOptions) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  const query = useQuery({
    queryKey: checkoutPrStatusQueryKey(serverId, cwd),
    queryFn: async () => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      return await client.checkoutPrStatus(cwd);
    },
    enabled: !!client && isConnected && !!cwd && enabled,
    staleTime: Infinity,
    // Refetch on mount only after explicit invalidation (e.g. reconnect) — see
    // useCheckoutStatusQuery for the rationale.
    refetchOnMount: true,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  const hosting = query.data?.hosting ?? null;
  return {
    status: query.data?.status ?? null,
    // Historically "are GitHub features on"; now "are hosting features on for
    // this workspace's provider". New daemons describe the provider in the
    // `hosting` block; old daemons only send the legacy GitHub flag. This is
    // the single normalization point — downstream policy/panel code stays
    // provider-agnostic.
    githubFeaturesEnabled: hosting?.featuresEnabled ?? query.data?.githubFeaturesEnabled ?? true,
    hostingProvider: normalizeGitHostingProviderId(hosting?.provider) ?? "github",
    hostingCapabilities: hosting?.capabilities ?? null,
    payloadError: query.data?.error ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
  };
}

export function useWorkspacePrHint({
  serverId,
  cwd,
  enabled = true,
}: UseCheckoutPrStatusQueryOptions): PrHint | null {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  const query = useQuery<CheckoutPrStatusPayload, Error, PrHint | null>({
    queryKey: checkoutPrStatusQueryKey(serverId, cwd),
    queryFn: async () => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      return await client.checkoutPrStatus(cwd);
    },
    enabled: !!client && isConnected && !!cwd && enabled,
    staleTime: Infinity,
    // Refetch on mount only after explicit invalidation (e.g. reconnect) — see
    // useCheckoutStatusQuery for the rationale.
    refetchOnMount: true,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    select: selectWorkspacePrHint,
  });

  return query.data ?? null;
}
