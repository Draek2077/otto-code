import type { SessionState } from "@/stores/session-store";
import {
  normalizeWorkspacePath,
  resolveWorkspaceMapKeyByIdentity,
} from "@/utils/workspace-identity";

export interface WorkspaceSelection {
  serverId: string;
  workspaceId: string;
}

export interface WorkspaceProjectScope {
  serverId: string;
  projectRootPath: string;
}

/**
 * Resolves the project that provides context on entry to an aggregate page.
 * The route's workspace is freshest, while the persisted workspace is what
 * remains after the reader navigates away to History, Artifacts, or another
 * aggregate view.
 */
export function resolvePreferredWorkspaceProjectScope(input: {
  activeWorkspace: WorkspaceSelection | null;
  lastWorkspace: WorkspaceSelection | null;
  sessions: Record<string, SessionState>;
}): WorkspaceProjectScope | null {
  const selection = input.activeWorkspace ?? input.lastWorkspace;
  if (!selection) return null;

  const workspaces = input.sessions[selection.serverId]?.workspaces;
  const workspaceKey = resolveWorkspaceMapKeyByIdentity({
    workspaces,
    workspaceId: selection.workspaceId,
  });
  const projectRootPath =
    workspaceKey === null
      ? null
      : normalizeWorkspacePath(workspaces?.get(workspaceKey)?.projectRootPath);
  return projectRootPath ? { serverId: selection.serverId, projectRootPath } : null;
}

/**
 * Finds a usable initial scope in the page's filter ids. Once a reader touches
 * either picker, aggregate screens intentionally stop applying this default.
 */
export function resolveInitialAggregateProjectScope(input: {
  hasExplicitSelection: boolean;
  preferredScope: WorkspaceProjectScope | null;
  availableHostIds: readonly string[];
  projectTargets: readonly { serverId: string; cwd: string }[];
}): { serverId: string; cwd: string } | null {
  if (input.hasExplicitSelection || !input.preferredScope) return null;
  if (!input.availableHostIds.includes(input.preferredScope.serverId)) return null;
  return (
    input.projectTargets.find(
      (target) =>
        target.serverId === input.preferredScope!.serverId &&
        normalizeWorkspacePath(target.cwd) === input.preferredScope!.projectRootPath,
    ) ?? null
  );
}
