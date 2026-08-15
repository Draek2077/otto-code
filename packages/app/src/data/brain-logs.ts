import type { QueryClient } from "@tanstack/react-query";
import type { SessionOutboundMessage } from "@otto-code/protocol/messages";

type StatusMessage = Extract<SessionOutboundMessage, { type: "status" }>;

export function brainLogsQueryKey(serverId: string) {
  return ["brain-console-logs", serverId] as const;
}

interface BrainLogTail {
  lines: string[];
  total: number;
  state?: string;
  command?: string | null;
}

/** Append one pushed durable line without waiting for the next tail request. */
export function applyBrainLogLineAdded(input: {
  serverId: string;
  queryClient: QueryClient;
  message: StatusMessage;
}): void {
  const payload = input.message.payload;
  if (
    typeof payload !== "object" ||
    payload === null ||
    payload.status !== "brain_log_line_added"
  ) {
    return;
  }
  const line = payload.line;
  if (typeof line !== "string") return;
  input.queryClient.setQueryData<BrainLogTail>(brainLogsQueryKey(input.serverId), (current) => {
    if (!current) return current;
    return {
      ...current,
      lines: [...current.lines, line].slice(-500),
      total: current.total + 1,
    };
  });
}

export function invalidateBrainLogsAfterReconnect(input: {
  queryClient: QueryClient;
  serverId: string;
}) {
  void input.queryClient.invalidateQueries({ queryKey: brainLogsQueryKey(input.serverId) });
}
