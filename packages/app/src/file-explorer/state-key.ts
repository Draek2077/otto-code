// Key space for the session store's `fileExplorer` map. It lives in its own
// dependency-free module because both the writer (hooks/use-file-explorer-actions)
// and the release path (stores/session-store `removeWorkspace`) need it, and the
// writer imports the store - so keeping the builder there would be a cycle.

export interface FileExplorerWorkspaceScope {
  workspaceId?: string | null;
  workspaceRoot?: string | null;
}

function normalizeWorkspaceValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * A pane keys its listings by workspace id when it has one and by workspace
 * root otherwise, so releasing a workspace has to clear both spellings.
 */
export function buildWorkspaceExplorerStateKey(scope: FileExplorerWorkspaceScope): string | null {
  const normalizedWorkspaceId = normalizeWorkspaceValue(scope.workspaceId);
  if (normalizedWorkspaceId) {
    return `workspace:${normalizedWorkspaceId}`;
  }
  const normalizedWorkspaceRoot = normalizeWorkspaceValue(scope.workspaceRoot);
  if (!normalizedWorkspaceRoot) {
    return null;
  }
  return `root:${normalizedWorkspaceRoot}`;
}

export { normalizeWorkspaceValue };
