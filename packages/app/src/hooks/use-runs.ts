import { useMutation, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { Run } from "@otto-code/protocol/orchestration";
import {
  getHostRuntimeStore,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
} from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useReplicaQuery } from "@/data/query";
import { applyRunsCleared, fetchRuns, runsQueryKey } from "@/data/runs";

/** A run tagged with the host it came from, for cross-host aggregation. */
export interface RunWithHost extends Run {
  serverId: string;
}

/**
 * The single detection point for the agent-orchestration capability.
 * COMPAT(agentOrchestration): added in v0.5.3, drop the gate when daemon floor >= v0.5.3.
 */
export function useAgentOrchestrationFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.agentOrchestration === true,
  );
}

/**
 * Live list of orchestration runs on a host: fetched once, then kept fresh by
 * runs.updated.notification pushes (merged in data/push-router.ts). Empty until
 * the host advertises the capability.
 */
export function useRuns(serverId: string | null): UseQueryResult<Run[], Error> {
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const supported = useAgentOrchestrationFeature(serverId ?? "");
  return useReplicaQuery<Run[]>({
    queryKey: runsQueryKey(serverId ?? ""),
    enabled: Boolean(serverId && client && isConnected && supported),
    pushEvent: "runs.updated.notification",
    queryFn: async () => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      return fetchRuns({ client });
    },
  });
}

/**
 * Approve or reject an attended run's gate. The resulting run-state change flows
 * back via the runs.updated.notification push, so no optimistic update is needed.
 */
export function useRespondToRunGate(serverId: string | null) {
  const client = useHostRuntimeClient(serverId ?? "");
  return useMutation({
    mutationFn: async (input: {
      runId: string;
      phaseId: string;
      approved: boolean;
      note?: string;
    }) => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      return client.respondToRunGate(input);
    },
  });
}

/**
 * Every agent id involved in a run: the conductor plus every phase's spawned
 * candidates. Shared by the token-cost rollup (runs-screen.tsx sumRunTokens)
 * and the Visualizer "Visualize this run" scoping (visualizer-panel.tsx).
 */
export function collectRunAgentIds(run: Run): Set<string> {
  const agentIds = new Set<string>();
  if (run.conductorAgentId) {
    agentIds.add(run.conductorAgentId);
  }
  for (const phase of run.phases) {
    for (const candidate of phase.candidates ?? []) {
      agentIds.add(candidate.agentId);
    }
  }
  return agentIds;
}

/** Cancel a run. The terminal run state arrives via the push. */
export function useCancelRun(serverId: string | null) {
  const client = useHostRuntimeClient(serverId ?? "");
  return useMutation({
    mutationFn: async (runId: string) => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      return client.cancelRun(runId);
    },
  });
}

/**
 * Delete every finished run on every given host in parallel. Prunes each
 * host's cache immediately so the UI updates without waiting on the
 * runs.cleared.notification round trip (that push still lands and is a
 * no-op once the ids are already gone).
 */
export function useClearFinishedRuns(): {
  clearAll: (serverIds: readonly string[]) => void;
  isPending: boolean;
} {
  const runtime = getHostRuntimeStore();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (serverIds: readonly string[]) => {
      await Promise.all(
        serverIds.map(async (serverId) => {
          const client = runtime.getClient(serverId);
          if (!client) {
            return;
          }
          const runIds = await client.clearFinishedRuns();
          applyRunsCleared({ queryClient, serverId, runIds });
        }),
      );
    },
  });
  return {
    clearAll: (serverIds) => mutation.mutate(serverIds),
    isPending: mutation.isPending,
  };
}
