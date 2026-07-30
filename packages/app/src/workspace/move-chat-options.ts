import type { WorkspaceDescriptor } from "@/stores/session-store";

/**
 * Candidate targets for moving a chat.
 *
 * Every live workspace on the host except the one the chat is already in, in the
 * same project or any other. A chat is not tied to a directory the way a
 * workspace is (see the `agent.workspace.transfer` schema), so there is nothing
 * to filter on beyond "is this a real workspace the user can get to".
 */
export interface MoveChatWorkspaceOption {
  workspaceId: string;
  /** The workspace's own label: its user-set title, else its derived name. */
  label: string;
  /** Project label, used to group and to disambiguate same-named workspaces. */
  projectLabel: string;
  /** True when the target belongs to a different project than the chat's own. */
  isCrossProject: boolean;
}

export function resolveWorkspaceLabel(workspace: WorkspaceDescriptor): string {
  return workspace.title?.trim() || workspace.name;
}

export function resolveProjectLabel(workspace: WorkspaceDescriptor): string {
  return workspace.projectCustomName?.trim() || workspace.projectDisplayName;
}

export function buildMoveChatWorkspaceOptions(input: {
  workspaces: Iterable<WorkspaceDescriptor> | undefined;
  /** The chat's current owner, excluded from the list. */
  currentWorkspaceId: string | null | undefined;
}): MoveChatWorkspaceOption[] {
  const currentProjectId = findCurrentProjectId(input.workspaces, input.currentWorkspaceId);
  const options: MoveChatWorkspaceOption[] = [];
  for (const workspace of input.workspaces ?? []) {
    if (workspace.id === input.currentWorkspaceId) {
      continue;
    }
    // Mid-archive workspaces are on their way out; offering one as a destination
    // would move a chat somewhere about to disappear.
    if (workspace.archivingAt) {
      continue;
    }
    options.push({
      workspaceId: workspace.id,
      label: resolveWorkspaceLabel(workspace),
      projectLabel: resolveProjectLabel(workspace),
      isCrossProject: currentProjectId !== null && workspace.projectId !== currentProjectId,
    });
  }
  // Same project first, then alphabetical, so the likely destination is nearest
  // the top without hiding the cross-project ones the feature exists for.
  return options.sort((left, right) => {
    if (left.isCrossProject !== right.isCrossProject) {
      return left.isCrossProject ? 1 : -1;
    }
    const byProject = left.projectLabel.localeCompare(right.projectLabel);
    return byProject !== 0 ? byProject : left.label.localeCompare(right.label);
  });
}

function findCurrentProjectId(
  workspaces: Iterable<WorkspaceDescriptor> | undefined,
  currentWorkspaceId: string | null | undefined,
): string | null {
  if (!currentWorkspaceId) {
    return null;
  }
  for (const workspace of workspaces ?? []) {
    if (workspace.id === currentWorkspaceId) {
      return workspace.projectId;
    }
  }
  return null;
}
