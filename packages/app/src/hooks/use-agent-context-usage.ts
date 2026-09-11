import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import type { AgentContextUsage } from "@otto-code/protocol/messages";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

const CONTEXT_USAGE_STALE_TIME_MS = 15 * 1000;

type ContextUsageClient = Pick<DaemonClient, "getAgentContextUsage">;
type ContextUsagePayload = Awaited<ReturnType<ContextUsageClient["getAgentContextUsage"]>>;

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
 * null - meaning "don't show a breakdown" - until a supported provider reports
 * one. A temporarily unavailable live handle keeps the last reported breakdown.
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
    const payload = await client.getAgentContextUsage(agentId);
    // Null also means the provider has no live handle right now, not that the
    // context is empty. Keep this host/agent's last measurement through that
    // gap, just as the composer ring keeps its last reported token count.
    if (payload.usage === null) {
      const cached = queryClient.getQueryData<ContextUsagePayload>(queryKey);
      return { ...payload, usage: cached?.usage ?? null };
    }
    return payload;
  }, [client, agentId, queryClient, queryKey]);

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
