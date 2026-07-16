import { useCallback } from "react";
import { useToast } from "@/contexts/toast-context";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import {
  requestClearCompletedSubagents,
  type ClearableSubagentRow,
} from "./clear-completed-subagents";
import { useClearedSubagentTokensStore } from "./cleared-subagent-tokens-store";

export {
  clearCompletedSubagents,
  requestClearCompletedSubagents,
  type ClearableSubagentRow,
  type ClearCompletedSubagentsDeps,
  type ClearCompletedSubagentsInput,
  type RequestClearCompletedSubagentsDeps,
} from "./clear-completed-subagents";

export interface UseClearCompletedSubagentsInput {
  serverId: string;
  parentAgentId: string;
}

export function useClearCompletedSubagents(
  input: UseClearCompletedSubagentsInput,
): (rows: readonly ClearableSubagentRow[]) => void {
  const { serverId, parentAgentId } = input;
  const { archiveAgent } = useArchiveAgent();
  const recordCleared = useClearedSubagentTokensStore((state) => state.recordCleared);
  const toast = useToast();

  return useCallback(
    (rows: readonly ClearableSubagentRow[]) => {
      void requestClearCompletedSubagents(
        { serverId, parentAgentId, rows },
        {
          confirm: confirmDialog,
          archiveAgent,
          recordCleared,
          reportError: (error) => {
            toast.error(toErrorMessage(error));
          },
        },
      );
    },
    [archiveAgent, parentAgentId, recordCleared, serverId, toast],
  );
}
