import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { normalizeGitHostingProviderId } from "@otto-code/protocol/messages";
import { checkoutPrStatusQueryKey } from "@/git/query-keys";
import { normalizeForge } from "@/git/forge";
import { selectPrHintFromStatus, type PrHint } from "@/git/pr-hint";
import { type CheckoutPrStatusPayload, normalizeCheckoutPrStatusPayload } from "@/git/pr-status";

interface UseCheckoutPrStatusQueryOptions {
  serverId: string;
  cwd: string;
  enabled?: boolean;
}

export type { CheckoutPrStatusPayload } from "@/git/pr-status";
export { selectPrHintFromStatus, type PrHint } from "@/git/pr-hint";

function selectWorkspacePrHint(payload: CheckoutPrStatusPayload): PrHint | null {
  return selectPrHintFromStatus(payload.status, payload.forge);
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
      return normalizeCheckoutPrStatusPayload(await client.checkoutPrStatus(cwd));
    },
    enabled: !!client && isConnected && !!cwd && enabled,
    staleTime: Infinity,
    // Refetch on mount only after explicit invalidation (e.g. reconnect) — see
    // useCheckoutStatusQuery for the rationale.
    refetchOnMount: true,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  return {
    ...projectPrStatusFacts(query.data),
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
  };
}

/**
 * The one place the wire payload becomes the shape the app reads. Old daemons
 * send only the legacy GitHub flag; new ones describe the provider in `hosting`
 * and name the forge, so every fallback lives here rather than at each call site.
 */
function projectPrStatusFacts(data: CheckoutPrStatusPayload | undefined) {
  const hosting = data?.hosting ?? null;
  return {
    status: data?.status ?? null,
    githubFeaturesEnabled: hosting?.featuresEnabled ?? data?.githubFeaturesEnabled ?? true,
    hostingProvider: normalizeGitHostingProviderId(hosting?.provider) ?? "github",
    hostingCapabilities: hosting?.capabilities ?? null,
    authState: data?.authState,
    forge: normalizeForge(data?.forge),
    // Null until a response arrives, so callers that can infer the forge from
    // the remote URL (e.g. web-URL grammar) don't act on the github default.
    resolvedForge: data === undefined ? null : normalizeForge(data.forge),
    payloadError: data?.error ?? null,
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
      return normalizeCheckoutPrStatusPayload(await client.checkoutPrStatus(cwd));
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
