import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { toErrorMessage } from "@/utils/error-messages";
import { requestStopBackgroundTask } from "./stop-background-task";

export { requestStopBackgroundTask } from "./stop-background-task";
export type {
  StopBackgroundTaskDeps,
  RequestStopBackgroundTaskInput,
} from "./stop-background-task";

export interface UseStopBackgroundTaskInput {
  serverId: string;
  parentAgentId: string;
}

export function useStopBackgroundTask(input: UseStopBackgroundTaskInput): (taskId: string) => void {
  const { serverId, parentAgentId } = input;
  const client = useHostRuntimeClient(serverId);
  const toast = useToast();
  const { t } = useTranslation();

  return useCallback(
    (taskId: string) => {
      void requestStopBackgroundTask(
        { parentAgentId, taskId },
        {
          stopBackgroundShellTask: (parent, id) =>
            client
              ? client.stopBackgroundShellTask(parent, id)
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
