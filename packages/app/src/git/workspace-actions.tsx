import { GitActionsSplitButton } from "@/git/actions-split-button";
import { GIT_ACTION_ICONS } from "@/git/action-icons";
import { useGitActions } from "@/git/use-actions";
import { useIsDeveloperMode } from "@/hooks/use-interface-mode";
import { WorkspaceBackups } from "./workspace-backups";

interface WorkspaceActionsProps {
  serverId: string;
  cwd: string;
  hideLabels?: boolean;
  // Stretch to fill the available width (content stays centered).
  fill?: boolean;
  /** Reports whether this workspace contributes a visible toolbar control. */
  onAvailabilityChange?: (available: boolean) => void;
  tooltipSide?: "top" | "bottom";
}

export function WorkspaceActions({
  serverId,
  cwd,
  hideLabels,
  fill,
  onAvailabilityChange,
  tooltipSide,
}: WorkspaceActionsProps) {
  const isDeveloperMode = useIsDeveloperMode();
  const { gitActions, backupWorkspaceMessage } = useGitActions({
    serverId,
    cwd,
    icons: GIT_ACTION_ICONS,
  });

  if (!isDeveloperMode) {
    return (
      <WorkspaceBackups
        serverId={serverId}
        cwd={cwd}
        gitActions={gitActions}
        workspaceMessage={backupWorkspaceMessage}
        hideLabels={hideLabels}
        fill={fill}
        onAvailabilityChange={onAvailabilityChange}
      />
    );
  }

  return (
    <GitActionsSplitButton
      gitActions={gitActions}
      hideLabels={hideLabels}
      fill={fill}
      onAvailabilityChange={onAvailabilityChange}
      tooltipSide={tooltipSide}
    />
  );
}
