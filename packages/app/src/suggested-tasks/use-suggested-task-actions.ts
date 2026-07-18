import { useCallback, useMemo } from "react";
import { useToast } from "@/contexts/toast-context";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { toErrorMessage } from "@/utils/error-messages";
import type { TasksSuggestedStartMode } from "@otto-code/protocol/messages";

export interface UseSuggestedTaskActionsInput {
  serverId: string;
  parentAgentId: string;
}

export interface SuggestedTaskActions {
  // One id starts a single chip; the whole pending queue starts them all,
  // applying the same mode to each (one agent/chat each — no combining).
  startTasks: (taskIds: readonly string[], mode: TasksSuggestedStartMode) => Promise<void>;
  dismissTasks: (taskIds: readonly string[]) => void;
}

const DAEMON_UNAVAILABLE = "Host is unavailable — reconnect to start this task.";

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

function startSuccessMessage(count: number, mode: TasksSuggestedStartMode): string | null {
  const label = pluralize(count, "task");
  if (mode === "worktree") {
    return `Started ${count} ${label} in ${pluralize(count, "new worktree")}`;
  }
  if (mode === "new_chat") {
    return `Started ${count} ${label} in ${pluralize(count, "new chat")}`;
  }
  if (mode === "subagent") {
    return `Started ${count} ${pluralize(count, "subagent")}`;
  }
  // in_session lands in the current chat — no toast, the result is on screen.
  return null;
}

export function useSuggestedTaskActions(input: UseSuggestedTaskActionsInput): SuggestedTaskActions {
  const { serverId, parentAgentId } = input;
  const client = useHostRuntimeClient(serverId);
  const toast = useToast();

  const startTasks = useCallback(
    async (taskIds: readonly string[], mode: TasksSuggestedStartMode): Promise<void> => {
      if (taskIds.length === 0) {
        return;
      }
      try {
        if (!client) {
          throw new Error(DAEMON_UNAVAILABLE);
        }
        const { succeeded, failed } = await client.startSuggestedTasks(
          parentAgentId,
          taskIds,
          mode,
        );
        if (failed > 0) {
          toast.error(`${failed} ${pluralize(failed, "task")} could not start`);
          return;
        }
        const message = startSuccessMessage(succeeded, mode);
        if (message) {
          toast.show(message, { variant: "success" });
        }
      } catch (error) {
        toast.error(toErrorMessage(error));
      }
    },
    [client, parentAgentId, toast],
  );

  const dismissTasks = useCallback(
    (taskIds: readonly string[]): void => {
      if (taskIds.length === 0) {
        return;
      }
      void (async () => {
        try {
          if (!client) {
            throw new Error(DAEMON_UNAVAILABLE);
          }
          await client.dismissSuggestedTasks(parentAgentId, taskIds);
        } catch (error) {
          toast.error(toErrorMessage(error));
        }
      })();
    },
    [client, parentAgentId, toast],
  );

  return useMemo(() => ({ startTasks, dismissTasks }), [startTasks, dismissTasks]);
}
