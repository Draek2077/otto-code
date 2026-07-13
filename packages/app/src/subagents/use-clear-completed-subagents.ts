import { useCallback } from "react";
import { useToast } from "@/contexts/toast-context";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import { requestClearCompletedSubagents } from "./clear-completed-subagents";

export { requestClearCompletedSubagents } from "./clear-completed-subagents";
export type {
  ClearCompletedSubagentsDeps,
  RequestClearCompletedSubagentsInput,
} from "./clear-completed-subagents";

export interface UseClearCompletedSubagentsInput {
  serverId: string;
}

export function useClearCompletedSubagents(
  input: UseClearCompletedSubagentsInput,
): (subagentIds: readonly string[]) => void {
  const { serverId } = input;
  const { archiveAgent } = useArchiveAgent();
  const toast = useToast();

  return useCallback(
    (subagentIds: readonly string[]) => {
      void requestClearCompletedSubagents(
        { serverId, subagentIds },
        {
          confirm: confirmDialog,
          archiveAgent,
          reportError: (error) => {
            toast.error(toErrorMessage(error));
          },
        },
      );
    },
    [archiveAgent, serverId, toast],
  );
}
