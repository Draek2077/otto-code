import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import { requestClearCompletedBackgroundTasks } from "./clear-completed-background-tasks";

export { requestClearCompletedBackgroundTasks } from "./clear-completed-background-tasks";
export type {
  ClearCompletedBackgroundTasksDeps,
  RequestClearCompletedBackgroundTasksInput,
} from "./clear-completed-background-tasks";

export interface UseClearCompletedBackgroundTasksInput {
  serverId: string;
  parentAgentId: string;
}

export function useClearCompletedBackgroundTasks(
  input: UseClearCompletedBackgroundTasksInput,
): (taskIds: readonly string[]) => void {
  const { serverId, parentAgentId } = input;
  const client = useHostRuntimeClient(serverId);
  const toast = useToast();
  const { t } = useTranslation();

  return useCallback(
    (taskIds: readonly string[]) => {
      void requestClearCompletedBackgroundTasks(
        { parentAgentId, taskIds },
        {
          confirm: confirmDialog,
          clearBackgroundShellTasks: (parent, ids) =>
            client
              ? client.clearBackgroundShellTasks(parent, ids)
              : Promise.reject(new Error(t("backgroundTasks.daemonUnavailable"))),
          reportError: (error) => {
            toast.error(toErrorMessage(error));
          },
        },
      );
    },
    [client, parentAgentId, toast, t],
  );
}
