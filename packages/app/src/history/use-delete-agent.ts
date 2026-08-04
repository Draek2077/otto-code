import { useCallback } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "@/stores/session-store";
import { agentHistoryQueryKey, allAgentHistoryQueryRootKey } from "@/hooks/agent-history-query-key";
import { removeAgentFromCachedLists, type AgentHistoryQueryData } from "@/hooks/use-archive-agent";

export interface DeleteAgentInput {
  serverId: string;
  agentId: string;
}

/**
 * Drop deleted chats out of a cached history page.
 *
 * Sibling to `markAgentArchivedInHistoryPayload` in use-archive-agent: archive
 * *patches* a row (it still exists, with a badge), delete *removes* it. Rows with
 * no `serverId` are treated as belonging to the requested host - the same
 * assumption the archive patcher makes, since single-host pages omit the field.
 */
export function removeAgentsFromHistoryPayload<T extends AgentHistoryQueryData | undefined>(
  payload: T,
  input: { serverId: string; agentIds: readonly string[] },
): T {
  if (!payload || !Array.isArray(payload.pages) || input.agentIds.length === 0) {
    return payload;
  }

  const doomed = new Set(input.agentIds);
  let changed = false;
  const pages = payload.pages.map((page) => {
    if (!Array.isArray(page.agents)) {
      return page;
    }
    const agents = page.agents.filter(
      (agent) =>
        !(
          agent.id != null &&
          doomed.has(agent.id) &&
          (agent.serverId == null || agent.serverId === input.serverId)
        ),
    );
    if (agents.length === page.agents.length) {
      return page;
    }
    changed = true;
    return { ...page, agents };
  });

  return changed ? ({ ...payload, pages } as T) : payload;
}

function removeAgentsFromHistoryCache(
  queryClient: QueryClient,
  input: { serverId: string; agentIds: readonly string[] },
): void {
  queryClient.setQueryData<AgentHistoryQueryData | undefined>(
    agentHistoryQueryKey(input.serverId),
    (current) => removeAgentsFromHistoryPayload(current, input),
  );
  queryClient.setQueriesData<AgentHistoryQueryData | undefined>(
    { queryKey: allAgentHistoryQueryRootKey() },
    (current) => removeAgentsFromHistoryPayload(current, input),
  );
}

function removeAgentsFromStore(serverId: string, agentIds: readonly string[]): void {
  useSessionStore.getState().setAgents(serverId, (prev) => {
    let next: typeof prev | null = null;
    for (const agentId of agentIds) {
      if (!prev.has(agentId)) {
        continue;
      }
      next ??= new Map(prev);
      next.delete(agentId);
    }
    return next ?? prev;
  });
}

export interface ApplyDeletedAgentResultsInput {
  queryClient: QueryClient;
  serverId: string;
  agentIds: readonly string[];
  invalidateQueries?: boolean;
}

/**
 * Reconcile the react-query caches after a delete.
 *
 * The `agent_deleted` push already cleaned every Zustand slice, but it never
 * touched react-query - so a deleted row lingered in the history list and the
 * sidebar until a manual refresh, which reads as the delete having failed. This
 * is the delete-side counterpart to `applyArchivedAgentCloseResults`, which
 * patches the same four caches for archive.
 */
export function applyDeletedAgentResults(input: ApplyDeletedAgentResultsInput): void {
  if (input.agentIds.length === 0) {
    return;
  }

  // The bulk sweep answers with one response rather than N `agent_deleted`
  // pushes, so it has no push handler to lean on for the store. Doing it here
  // means both paths are complete through the same function; for the single
  // delete this is a no-op the push has already done.
  removeAgentsFromStore(input.serverId, input.agentIds);

  for (const agentId of input.agentIds) {
    removeAgentFromCachedLists(input.queryClient, { serverId: input.serverId, agentId });
  }
  removeAgentsFromHistoryCache(input.queryClient, {
    serverId: input.serverId,
    agentIds: input.agentIds,
  });

  if (input.invalidateQueries ?? true) {
    void input.queryClient.invalidateQueries({
      queryKey: ["sidebarAgentsList", input.serverId],
    });
    void input.queryClient.invalidateQueries({
      queryKey: ["allAgents", input.serverId],
    });
    void input.queryClient.invalidateQueries({
      queryKey: agentHistoryQueryKey(input.serverId),
    });
    void input.queryClient.invalidateQueries({
      queryKey: allAgentHistoryQueryRootKey(),
    });
  }
}

/**
 * Hard-delete one chat record. The row leaves every surface via the daemon's
 * `agent_deleted` push (store slices) plus {@link applyDeletedAgentResults}
 * (query caches), which the session-context handler runs for both the single and
 * bulk paths.
 *
 * Gate on `useHistoryDeleteFeature` before offering this - there is no fallback
 * for an old daemon.
 */
export function useDeleteAgent(): {
  deleteAgent: (input: DeleteAgentInput) => Promise<void>;
  isDeleting: boolean;
} {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async (input: DeleteAgentInput): Promise<void> => {
      const client = useSessionStore.getState().sessions[input.serverId]?.client ?? null;
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      await client.deleteAgent(input.agentId);
    },
    onSuccess: (_result, input) => {
      // Belt and braces: the push handler already reconciled, but a dropped
      // notification must not leave a deleted row on screen.
      applyDeletedAgentResults({
        queryClient,
        serverId: input.serverId,
        agentIds: [input.agentId],
      });
    },
  });

  const mutateAsync = deleteMutation.mutateAsync;
  const deleteAgent = useCallback(
    async (input: DeleteAgentInput): Promise<void> => {
      await mutateAsync(input);
    },
    [mutateAsync],
  );

  return { deleteAgent, isDeleting: deleteMutation.isPending };
}
