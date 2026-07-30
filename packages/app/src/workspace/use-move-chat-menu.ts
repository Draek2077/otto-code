import { useCallback, useMemo } from "react";
import { useSessionStore } from "@/stores/session-store";
import { openMoveChat } from "@/workspace/move-chat-store";

/**
 * Menu inputs for "Move to workspace", resolved per host.
 *
 * Returns an absent handler when the daemon predates
 * `agent.workspace.transfer`, and `canMove: false` when the host has no other
 * workspace to move to. The menu omits the entry in both cases: there is no
 * degraded client-side version of restamping daemon-side ownership, and a row
 * that can only fail is worse than no row.
 */
export function useMoveChatMenu(serverId: string): {
  onMoveToWorkspace: ((agentId: string) => void) | undefined;
  canMove: boolean;
} {
  const supportsTransfer = useSessionStore(
    // COMPAT(agentWorkspaceTransfer): added in v0.7.4, drop the gate when daemon
    // floor >= v0.7.4.
    (state) => state.sessions[serverId]?.serverInfo?.features?.agentWorkspaceTransfer === true,
  );
  const workspaceCount = useSessionStore(
    (state) => state.sessions[serverId]?.workspaces?.size ?? 0,
  );

  const handleMoveToWorkspace = useCallback(
    (agentId: string) => {
      const session = useSessionStore.getState().sessions[serverId];
      const agent = session?.agents?.get(agentId) ?? session?.agentDetails?.get(agentId) ?? null;
      openMoveChat({
        serverId,
        agentId,
        chatLabel: agent?.title?.trim() || agentId,
        workspaceId: agent?.workspaceId ?? null,
      });
    },
    [serverId],
  );

  return useMemo(
    () => ({
      onMoveToWorkspace: supportsTransfer ? handleMoveToWorkspace : undefined,
      // One workspace on the host means the only workspace is the one the chat is
      // already in.
      canMove: supportsTransfer && workspaceCount > 1,
    }),
    [handleMoveToWorkspace, supportsTransfer, workspaceCount],
  );
}
