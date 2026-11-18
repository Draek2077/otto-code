import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useSessionStore } from "@/stores/session-store";
import { CHAT_PROFILE_LABEL, readChatProfile } from "./profile-binding";

const noSubscription = () => () => undefined;

/** A scalar subscription to the canonical agent snapshot, with no extra cache or transport. */
export function useChatProfileColors(serverId: string, agentId: string | null) {
  const getSnapshot = useCallback(() => {
    if (!agentId) return undefined;
    const session = useSessionStore.getState().sessions[serverId];
    const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
    return agent?.labels[CHAT_PROFILE_LABEL];
  }, [agentId, serverId]);
  // Non-chat tabs share the presentation resolver but add no chat-store listener.
  const serialized = useSyncExternalStore(
    agentId ? useSessionStore.subscribe : noSubscription,
    getSnapshot,
    getSnapshot,
  );
  return useMemo(() => readChatProfile(serialized)?.spinner, [serialized]);
}
