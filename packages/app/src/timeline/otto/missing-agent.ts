import type { AgentScreenReadySyncState } from "@/hooks/use-agent-screen-state-machine";

/** The existing fetch-agent response names the missing agent exactly.
 * Do not treat transport failures, missing files, or another agent as deletion.
 */
export function isConfirmedMissingTimelineAgent(error: unknown, agentId: string): boolean {
  const message = error instanceof Error ? error.message : error;
  return message === `Agent not found: ${agentId}`;
}

/** Presentation of the current sync error; this does not own sync state or cached rows. */
export function projectTimelineSyncFailure(
  sync: AgentScreenReadySyncState | undefined,
  error: unknown,
  agentId: string,
): {
  showHistorySyncMissing: boolean;
  showHistorySyncError: boolean;
  isRetryingHistorySync: boolean;
} {
  if (sync?.status !== "sync_error") {
    return {
      showHistorySyncMissing: false,
      showHistorySyncError: false,
      isRetryingHistorySync: false,
    };
  }
  const missing = isConfirmedMissingTimelineAgent(error, agentId);
  return {
    showHistorySyncMissing: missing,
    showHistorySyncError: !missing,
    isRetryingHistorySync: sync.isRetrying,
  };
}
