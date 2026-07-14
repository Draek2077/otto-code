import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";
import { requestStopSubagent, type StopSubagentTarget } from "./stop-subagent";

export { requestStopSubagent } from "./stop-subagent";
export type {
  StopSubagentDeps,
  StopSubagentTarget,
  RequestStopSubagentInput,
} from "./stop-subagent";

export interface UseStopSubagentInput {
  serverId: string;
}

export function useStopSubagent(input: UseStopSubagentInput): (subagentId: string) => void {
  const { serverId } = input;
  const client = useHostRuntimeClient(serverId);
  const toast = useToast();
  const { t } = useTranslation();

  return useCallback(
    (subagentId: string) => {
      void requestStopSubagent(
        { serverId, subagentId },
        {
          getSubagent: (id): StopSubagentTarget | undefined => {
            const session = useSessionStore.getState().sessions[serverId];
            return session?.agents?.get(id) ?? session?.agentDetails?.get(id);
          },
          stopObservedSubagent: (id) =>
            client
              ? client.stopObservedSubagent(id)
              : Promise.reject(new Error(t("subagents.daemonUnavailable"))),
          cancelAgent: (id) =>
            client
              ? client.cancelAgent(id)
              : Promise.reject(new Error(t("subagents.daemonUnavailable"))),
          reportError: (error) => {
            toast.error(toErrorMessage(error));
          },
          reportNothingToStop: () => {
            toast.show(t("subagents.stopNothingRunning"));
          },
        },
      );
    },
    [client, serverId, t, toast],
  );
}
