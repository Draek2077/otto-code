export interface ProjectContextWorkspace {
  serverId: string;
  workspaceId: string;
}

export interface ActiveWorkspaceTarget {
  serverId: string;
  workspaceId: string;
}

/**
 * Picks which workspace a project-level "Manage context" action should open.
 *
 * A project can hold several workspaces (and even span hosts), but a context
 * report belongs to exactly one workspace + provider pair. Preferring the
 * workspace the user is currently in means the action reports on what they are
 * looking at; otherwise the sidebar list is ordered most-recently-active first,
 * so the head of the list is the best available guess.
 *
 * Returns null for a project with no workspaces — the caller hides the item
 * rather than opening a tab that cannot resolve.
 */
export function resolveProjectContextTarget(
  workspaces: readonly ProjectContextWorkspace[],
  activeSelection: ActiveWorkspaceTarget | null | undefined,
): ProjectContextWorkspace | null {
  if (workspaces.length === 0) return null;
  if (activeSelection) {
    const active = workspaces.find(
      (workspace) =>
        workspace.serverId === activeSelection.serverId &&
        workspace.workspaceId === activeSelection.workspaceId,
    );
    if (active) return { serverId: active.serverId, workspaceId: active.workspaceId };
  }
  const first = workspaces[0];
  if (!first) return null;
  return { serverId: first.serverId, workspaceId: first.workspaceId };
}
