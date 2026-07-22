import { useMutation, type UseQueryResult } from "@tanstack/react-query";
import type { OrchestrationGraph, PromptTemplate } from "@otto-code/protocol/orchestration";
import { isDev } from "@/constants/platform";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useReplicaQuery } from "@/data/query";
import { fetchOrchestrationGraphs, orchestrationGraphsQueryKey } from "@/data/orchestration-graphs";
import { fetchPromptTemplates, promptTemplatesQueryKey } from "@/data/prompt-templates";

/**
 * The single detection point for the orchestration-graphs capability
 * (user orchestrations: the New Orchestration dialog + graph designer).
 *
 * Dev builds only while the node editor is still being built out: the whole
 * surface — the New Orchestration dialog, the designer tab, running graph
 * orchestrations — stays out of release builds, which keep the Orchestrations
 * page exactly as it was. `isDev` is Metro's `__DEV__`, so a production bundle
 * dead-code-strips the branch entirely.
 * COMPAT(orchestrationGraphs): added in v0.6.7, drop the gate when daemon floor >= v0.6.7.
 */
export function useOrchestrationGraphsFeature(serverId: string): boolean {
  const hostSupports = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.orchestrationGraphs === true,
  );
  return isDev && hostSupports;
}

/**
 * Live list of the host's reusable orchestration graph templates: fetched once,
 * then kept fresh by runs.graphs.changed.notification pushes (which carry the
 * full list — see data/push-router.ts).
 */
export function useOrchestrationGraphs(
  serverId: string | null,
): UseQueryResult<OrchestrationGraph[], Error> {
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const supported = useOrchestrationGraphsFeature(serverId ?? "");
  return useReplicaQuery<OrchestrationGraph[]>({
    queryKey: orchestrationGraphsQueryKey(serverId ?? ""),
    enabled: Boolean(serverId && client && isConnected && supported),
    pushEvent: "runs.graphs.changed.notification",
    queryFn: async () => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      return fetchOrchestrationGraphs({ client });
    },
  });
}

/**
 * Live list of the host's reusable prompt templates and snippets — what a graph
 * node's "Prompt template" select offers. Same capability gate as the graphs
 * themselves: both halves ship together.
 */
export function usePromptTemplates(
  serverId: string | null,
): UseQueryResult<PromptTemplate[], Error> {
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const supported = useOrchestrationGraphsFeature(serverId ?? "");
  return useReplicaQuery<PromptTemplate[]>({
    queryKey: promptTemplatesQueryKey(serverId ?? ""),
    enabled: Boolean(serverId && client && isConnected && supported),
    pushEvent: "runs.templates.changed.notification",
    queryFn: async () => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      return fetchPromptTemplates({ client });
    },
  });
}

/** Upsert a graph template. The cache refresh arrives via the changed push. */
export function useSaveOrchestrationGraph(serverId: string | null) {
  const client = useHostRuntimeClient(serverId ?? "");
  return useMutation({
    mutationFn: async (graph: OrchestrationGraph) => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      return client.saveOrchestrationGraph(graph);
    },
  });
}

/** Delete a graph template (built-in starters refuse daemon-side). */
export function useDeleteOrchestrationGraph(serverId: string | null) {
  const client = useHostRuntimeClient(serverId ?? "");
  return useMutation({
    mutationFn: async (graphId: string) => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      return client.deleteOrchestrationGraph(graphId);
    },
  });
}

export interface StartOrchestrationInput {
  flavor: "ai" | "graph";
  cwd: string;
  workspaceId?: string;
  title?: string;
  description?: string;
  orchestratorPersonalityId?: string;
  orchestratorProvider?: string;
  orchestratorModel?: string;
  orchestratorThinkingOptionId?: string;
  prompt?: string;
  graphId?: string;
  graphInputs?: Record<string, string>;
  draft?: boolean;
  runId?: string;
}

/**
 * Start (or draft) a user-initiated orchestration. Run/agent state flows back
 * via the runs.updated push; callers navigate to the returned agent's chat.
 */
export function useStartOrchestration(serverId: string | null) {
  const client = useHostRuntimeClient(serverId ?? "");
  return useMutation({
    mutationFn: async (input: StartOrchestrationInput) => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      return client.startOrchestration(input);
    },
  });
}
