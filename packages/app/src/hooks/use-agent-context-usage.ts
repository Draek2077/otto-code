import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import type { AgentContextUsage } from "@otto-code/protocol/messages";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

const CONTEXT_USAGE_STALE_TIME_MS = 15 * 1000;

type ContextUsageClient = Pick<DaemonClient, "getAgentContextUsage">;

export function agentContextUsageQueryKey(
  serverId: string | null | undefined,
  agentId: string | null | undefined,
) {
  return ["agentContextUsage", serverId ?? "", agentId ?? ""] as const;
}

interface UseAgentContextUsageOptions {
  enabled?: boolean;
}

/**
 * Fetches the per-category context window breakdown for an agent. Resolves to
 * null — meaning "don't show a breakdown" — when the daemon predates the RPC,
 * the agent's provider can't report one, or the fetch hasn't completed yet.
 */
export function useAgentContextUsage(
  serverId: string | null | undefined,
  agentId: string | null | undefined,
  options: UseAgentContextUsageOptions = {},
): { usage: AgentContextUsage | null; refresh: () => Promise<void> } {
  const queryClient = useQueryClient();
  const client: ContextUsageClient | null = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  // COMPAT(agentContextUsage): added in v0.3.4, drop the gate when daemon floor >= v0.3.4.
  const isSupported = useSessionStore(
    (state) => state.sessions[serverId ?? ""]?.serverInfo?.features?.agentContextUsage === true,
  );
  const queryKey = useMemo(() => agentContextUsageQueryKey(serverId, agentId), [serverId, agentId]);
  const canFetch = Boolean(serverId && agentId && client && isConnected && isSupported);
  const enabled = Boolean((options.enabled ?? true) && canFetch);

  const queryFn = useCallback(async () => {
    if (!client || !agentId) {
      throw new Error("Host connection unavailable");
    }
    return client.getAgentContextUsage(agentId);
  }, [client, agentId]);

  const query = useQuery({
    queryKey,
    queryFn,
    enabled,
    staleTime: CONTEXT_USAGE_STALE_TIME_MS,
    refetchOnMount: true,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
    if (!canFetch) {
      return;
    }
    await queryClient.fetchQuery({
      queryKey,
      queryFn,
      staleTime: CONTEXT_USAGE_STALE_TIME_MS,
    });
  }, [canFetch, queryClient, queryFn, queryKey]);

  return { usage: query.data?.usage ?? null, refresh };
}
