import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import type { AgentStreamEventPayload } from "@otto-code/protocol/messages";
import { useSessionStore } from "@/stores/session-store";
import { useGitLogStore } from "@/git/log-store";

/** Otto sidebands leave stream sequencing and turn ownership with ViewedTimelineOwner. */
export function applyOttoAgentStreamEvent(
  serverId: string,
  agentId: string,
  event: AgentStreamEventPayload,
): void {
  const store = useSessionStore.getState();
  if (event.type === "prompt_suggestion") {
    store.setAgentPromptSuggestion(serverId, agentId, event.suggestion);
  } else if (event.type === "turn_started") {
    store.setAgentPromptSuggestion(serverId, agentId, null);
  } else if (event.type === "rate_limit_updated") {
    // Recovery is a value too: retaining an earlier warning would strand the composer.
    store.setAgentRateLimit(serverId, agentId, event.info);
  }
}

/** One subscription set per host; empty task snapshots replace earlier lists. */
export function subscribeOttoSessionEvents(
  client: Pick<DaemonClient, "on">,
  serverId: string,
): () => void {
  const unsubscribe = [
    client.on("suggested_tasks_changed", (message) => {
      if (message.type !== "suggested_tasks_changed") return;
      const { parentAgentId, tasks } = message.payload;
      useSessionStore.getState().setSuggestedTasksForParent(serverId, parentAgentId, tasks);
    }),
    client.on("background_shell_tasks_changed", (message) => {
      if (message.type !== "background_shell_tasks_changed") return;
      const { parentAgentId, tasks } = message.payload;
      useSessionStore.getState().setBackgroundShellTasksForParent(serverId, parentAgentId, tasks);
    }),
    client.on("checkout.git.log_appended.notification", (message) => {
      if (message.type !== "checkout.git.log_appended.notification") return;
      useGitLogStore.getState().mergeEntries({
        serverId,
        cwd: message.payload.cwd,
        operation: message.payload.operation,
        entries: message.payload.entries,
      });
    }),
  ];
  return () => unsubscribe.forEach((dispose) => dispose());
}
