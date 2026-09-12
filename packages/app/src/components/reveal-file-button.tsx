import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen } from "@/components/icons/material-icons";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { buildAbsoluteExplorerPath } from "@/utils/explorer-paths";
import { openDesktopTarget, useDesktopOpenTargets } from "@/workspace/desktop-open-targets";

export function RevealFileButton({
  serverId,
  workspaceRoot,
  path,
}: {
  serverId: string;
  workspaceRoot: string;
  path: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const isLocalDaemon = useIsLocalDaemon(serverId);
  const { targets, isAvailable } = useDesktopOpenTargets({ isLocalExecution: isLocalDaemon });
  const fileManagerTarget = targets.find((target) => target.kind === "file-manager");
  const canReveal = isAvailable && Boolean(fileManagerTarget);
  const handleReveal = useCallback(() => {
    if (!canReveal || !fileManagerTarget) return;
    void openDesktopTarget({
      editorId: fileManagerTarget.id,
      workspacePath: workspaceRoot,
      filePath: buildAbsoluteExplorerPath({ workspaceRoot, entryPath: path }),
    }).catch((cause) => {
      toast.error(
        cause instanceof Error ? cause.message : t("workspace.fileExplorer.errors.revealFailed"),
      );
    });
  }, [canReveal, fileManagerTarget, workspaceRoot, path, t, toast]);

  if (!canReveal || !fileManagerTarget) return null;

  return (
    <Button
      testID="file-reveal-button"
      variant="outline"
      size="sm"
      leftIcon={FolderOpen}
      onPress={handleReveal}
    >
      {t("workspace.fileActions.revealIn", { target: fileManagerTarget.label })}
    </Button>
  );
}
