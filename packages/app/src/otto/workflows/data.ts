import { useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import {
  workflowWatch,
  unwrapWorkflowResult,
  type WorkflowScope,
} from "@getpaseo/plugin/otto/workflows";
import { useFetchQuery } from "@/data/query";
export function workflowQueryRoot(scope: WorkflowScope) {
  return ["ottoWorkflows", scope.hostId, scope.projectId] as const;
}
/** One deduplicated demand-owned long poll per selected project. Hidden views do not renew it. */
export function useWorkflowObservation(scope: WorkflowScope, active: boolean) {
  const client = useQueryClient(),
    watch = useRpc(workflowWatch);
  const key = [...workflowQueryRoot(scope), "watch"];
  const state = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 0,
    queryKey: key,
    enabled: active,
    retry: false,
    refetchInterval: active ? 100 : false,
    queryFn: async () =>
      unwrapWorkflowResult(
        await watch({
          scope,
          version: client.getQueryData<{ version: number }>(key)?.version ?? 0,
        }),
      ),
  });
  const version = state.data?.version;
  useEffect(() => {
    if (version !== undefined)
      void client.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === "ottoWorkflows" &&
          query.queryKey[1] === scope.hostId &&
          query.queryKey[2] === scope.projectId &&
          query.queryKey[3] !== "watch",
      });
  }, [client, version, scope.hostId, scope.projectId]);
  return useCallback(
    () =>
      client.invalidateQueries({
        queryKey: workflowQueryRoot(scope),
        predicate: (query) => query.queryKey[3] !== "watch",
      }),
    [client, scope],
  );
}
