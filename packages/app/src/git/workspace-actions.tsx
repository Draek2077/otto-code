import { GitActionsSplitButton } from "@/git/actions-split-button";
import { GIT_ACTION_ICONS } from "@/git/action-icons";
import { useGitActions } from "@/git/use-actions";

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
  const { gitActions } = useGitActions({
    serverId,
    cwd,
    icons: GIT_ACTION_ICONS,
  });

  return (
    <GitActionsSplitButton
      gitActions={gitActions}
      hideLabels={hideLabels}
      fill={fill}
      onAvailabilityChange={onAvailabilityChange}
      tooltipSide={tooltipSide}
    />
  );
  return <GitActionsSplitButton gitActions={gitActions} />;
}
