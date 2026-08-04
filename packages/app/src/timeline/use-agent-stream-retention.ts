import { useEffect } from "react";
import { useSessionStore } from "@/stores/session-store";

/**
 * Declare that this component is rendering an agent's stream buffers, so
 * retention will not release them underneath it.
 *
 * Every surface that reads `agentStreamTail` / `agentStreamHead` for display
 * must call this. Retention is explicit rather than inferred from focus or
 * lifecycle precisely so that a background pane - mounted, not focused, and
 * invisible to every other signal in the store - is never blanked by an
 * eviction. See timeline/agent-stream-retention.ts for the release rule.
 *
 * Pass a null `agentId` for a surface that sometimes has no agent (a draft
 * tab); the hook is then inert.
 */
export function useAgentStreamRetention(serverId: string, agentId: string | null): void {
  // A retainer registered before the session exists lands nowhere, and this
  // hook's own deps would never fire again to correct it - a panel that mounted
  // ahead of session init would then be invisible to retention for its whole
  // life. Re-running on session arrival closes that window.
  const hasSession = useSessionStore((state) => Boolean(state.sessions[serverId]));

  useEffect(() => {
    if (!serverId || !agentId || !hasSession) {
      return;
    }
    return useSessionStore.getState().retainAgentStream(serverId, agentId);
  }, [agentId, hasSession, serverId]);
}
