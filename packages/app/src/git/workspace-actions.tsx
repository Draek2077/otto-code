import { GitActionsSplitButton } from "@/git/actions-split-button";
import { GIT_ACTION_ICONS } from "@/git/action-icons";
import { useGitActions } from "@/git/use-actions";

interface WorkspaceActionsProps {
  serverId: string;
  // OTTO(git-fetch): use the real workspace identity, never a client path lookup.
  workspaceId: string;
  cwd: string;
}

export function WorkspaceActions({ serverId, workspaceId, cwd }: WorkspaceActionsProps) {
  const { gitActions } = useGitActions({
    serverId,
    workspaceId,
    cwd,
    icons: GIT_ACTION_ICONS,
  });

  return <GitActionsSplitButton gitActions={gitActions} />;
}
