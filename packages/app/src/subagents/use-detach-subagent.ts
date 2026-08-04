import { useCallback } from "react";
import { useToast } from "@/contexts/toast-context";
import { i18n } from "@/i18n/i18next";
import { useSessionStore } from "@/stores/session-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { requestDetachSubagent, type ResolveDetachSubagentDialogInput } from "./detach-subagent";

export { resolveDetachSubagentDialog, requestDetachSubagent } from "./detach-subagent";
export type {
  DetachSubagentDeps,
  RequestDetachSubagentInput,
  ResolveDetachSubagentDialogInput,
} from "./detach-subagent";

export interface UseDetachSubagentInput {
  serverId: string;
}

export function useDetachSubagent(input: UseDetachSubagentInput): (subagentId: string) => void {
  const { serverId } = input;
  const toast = useToast();

  return useCallback(
    (subagentId: string) => {
      void requestDetachSubagent(
        { serverId, subagentId },
        {
          getSubagent: (id): ResolveDetachSubagentDialogInput | undefined =>
            useSessionStore.getState().sessions[serverId]?.agents?.get(id),
          confirm: confirmDialog,
          detachAgent: async ({ serverId: targetServerId, agentId }) => {
            const client = useSessionStore.getState().sessions[targetServerId]?.client;
            if (!client) {
              throw new Error(i18n.t("workspaceSetup.errors.hostDisconnected"));
            }
            await client.detachAgent(agentId);
            // Drop the parent link locally the moment the daemon confirms.
            // Detach is a deliberate, confirmed action, so the parent's
            // sub-agents track should stop listing the child immediately
            // instead of waiting for the next authoritative refetch - the row
            // used to sit there until a reload, which reads as a failed detach
            // even though the daemon had already cleared the label.
            useSessionStore.getState().setAgents(targetServerId, (prev) => {
              const current = prev.get(agentId);
              if (!current || current.parentAgentId === null) {
                return prev;
              }
              const next = new Map(prev);
              next.set(agentId, { ...current, parentAgentId: null });
              return next;
            });
          },
          openDetachedAgent: ({ serverId: targetServerId, agentId }) => {
            navigateToAgent({ serverId: targetServerId, agentId });
          },
          reportError: (error) => {
            toast.error(toErrorMessage(error));
          },
        },
      );
    },
    [serverId, toast],
  );
}
