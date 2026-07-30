import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MoveChatToWorkspaceSheet } from "@/components/move-chat-to-workspace-sheet";
import { useMoveChatStore } from "@/workspace/move-chat-store";
import { buildMoveChatWorkspaceOptions } from "@/workspace/move-chat-options";
import { useSessionStore } from "@/stores/session-store";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";

/**
 * Mounts the move-chat sheet once for the workspace screen and performs the move.
 *
 * The sheet lives here rather than beside the menu entry that opens it because
 * the entry is rebuilt per tab: rendering a sheet per tab would mean N copies of
 * the same modal, and closing the tab mid-move would unmount the request.
 */
export function MoveChatToWorkspaceHost() {
  const { t } = useTranslation();
  const toast = useToast();
  const target = useMoveChatStore((state) => state.target);
  const closeMoveChat = useMoveChatStore((state) => state.closeMoveChat);
  const serverId = target?.serverId ?? "";
  const client = useHostRuntimeClient(serverId);
  const workspaces = useSessionStore((state) =>
    serverId ? state.sessions[serverId]?.workspaces : undefined,
  );

  const options = useMemo(
    () =>
      buildMoveChatWorkspaceOptions({
        workspaces: workspaces?.values(),
        currentWorkspaceId: target?.workspaceId ?? null,
      }),
    [target?.workspaceId, workspaces],
  );

  const handleMove = useCallback(
    async (workspaceId: string) => {
      if (!client || !target) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      await client.transferAgentWorkspace(target.agentId, workspaceId);
      // The daemon re-emits the chat and both workspaces, so the tab relocating
      // is the real confirmation. The toast names the destination because the tab
      // leaves the current view the moment it lands.
      const moved = options.find((option) => option.workspaceId === workspaceId);
      toast.show(t("workspace.moveChat.moved", { workspace: moved?.label ?? workspaceId }));
    },
    [client, options, t, target, toast],
  );

  if (!target) {
    return null;
  }

  return (
    <MoveChatToWorkspaceSheet
      visible
      chatLabel={target.chatLabel}
      options={options}
      onClose={closeMoveChat}
      onMove={handleMove}
    />
  );
}
