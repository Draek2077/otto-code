import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import { getHostRuntimeStore, isHostRuntimeConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { alertDialog, confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import {
  requestClearArchivedAgents,
  type ClearArchivedHost,
  type ClearArchivedOutcome,
} from "./clear-archived-agents";
import { applyDeletedAgentResults } from "./use-delete-agent";

export interface ClearArchivedAgentsRequest {
  /** Hosts to sweep. Unconnected hosts and hosts without the capability drop out. */
  serverIds: readonly string[];
  olderThanDays?: number;
}

/**
 * Resolve the hosts a sweep may actually run against: connected, with a client,
 * and advertising `features.historyDelete`. A host that fails any of those is
 * dropped silently rather than surfaced as an error — the button is already gated
 * on at least one eligible host, so this is the race-at-press-time case.
 */
function resolveSweepableHosts(serverIds: readonly string[]): ClearArchivedHost[] {
  const runtime = getHostRuntimeStore();
  const sessions = useSessionStore.getState().sessions;
  const hosts: ClearArchivedHost[] = [];

  for (const serverId of serverIds) {
    const client = runtime.getClient(serverId);
    if (!client || !isHostRuntimeConnected(runtime.getSnapshot(serverId))) {
      continue;
    }
    if (sessions[serverId]?.serverInfo?.features?.historyDelete !== true) {
      continue;
    }
    hosts.push({
      serverId,
      clearArchivedAgents: (options) => client.clearArchivedAgents(options),
    });
  }

  return hosts;
}

/**
 * "Clear archived" on the History screen: dry-run for a count, confirm with that
 * count, then delete. Otto's records only — see delete-dialogs.ts for what the
 * user is told stays behind.
 */
export function useClearArchivedAgents(): {
  clearArchived: (request: ClearArchivedAgentsRequest) => Promise<ClearArchivedOutcome | null>;
  isClearing: boolean;
} {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [isClearing, setIsClearing] = useState(false);

  const clearArchived = useCallback(
    async (request: ClearArchivedAgentsRequest): Promise<ClearArchivedOutcome | null> => {
      setIsClearing(true);
      try {
        return await requestClearArchivedAgents(
          {
            hosts: resolveSweepableHosts(request.serverIds),
            olderThanDays: request.olderThanDays,
          },
          {
            confirm: confirmDialog,
            alert: alertDialog,
            onDeleted: ({ serverId, agentIds }) => {
              applyDeletedAgentResults({ queryClient, serverId, agentIds });
            },
            reportError: (error) => {
              toast.error(toErrorMessage(error));
            },
          },
        );
      } finally {
        setIsClearing(false);
      }
    },
    [queryClient, toast],
  );

  return { clearArchived, isClearing };
}
