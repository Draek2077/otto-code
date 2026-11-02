import { useCallback } from "react";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useFileExplorerActions } from "@/hooks/use-file-explorer-actions";
import { openExplorerSidebarView } from "@/workspace-tabs/explorer-sidebar";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

export function useTerminalDirectory(input: {
  serverId: string;
  workspaceId: string;
  root: string | null;
  isGit: boolean;
}) {
  const { serverId, workspaceId, root, isGit } = input;
  const isCompact = useIsCompactFormFactor();
  const { revealDirectory } = useFileExplorerActions({
    serverId,
    workspaceId,
    workspaceRoot: root,
  });
  return useCallback(
    (directory: string) => {
      if (!root) return;
      void revealDirectory(directory);
      openExplorerSidebarView({
        isCompact,
        workspaceKey: buildWorkspaceTabPersistenceKey({ serverId, workspaceId }),
        checkout: { serverId, cwd: root, isGit },
        view: "files",
      });
    },
    [isCompact, isGit, revealDirectory, root, serverId, workspaceId],
  );
}
