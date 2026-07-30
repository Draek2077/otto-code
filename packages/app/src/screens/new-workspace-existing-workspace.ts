import type { WorkspaceDescriptor } from "@/stores/session-store";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";

/**
 * Finding the workspace that is *already there* is the shared precondition of
 * every "you don't need a new workspace for this" path on the New Workspace
 * screen: the occupied-directory steer, and View Documentation. Both used to ask
 * the same narrow question (which workspace's own directory is this?) and both
 * were wrong for the same reason, so the question lives here once.
 *
 * Pure over an iterable of descriptors rather than reaching into the session
 * store, so the matching rules are unit-testable without a store.
 */

/**
 * The live workspace whose *own* directory is `directory`.
 *
 * This is exactly the question the daemon's occupied-directory refusal asks: one
 * directory backs at most one visible workspace, so at most one can match. Use
 * this when the directory itself is the thing being contended.
 */
export function findWorkspaceForDirectory(input: {
  workspaces: Iterable<WorkspaceDescriptor> | undefined;
  directory: string;
}): WorkspaceDescriptor | null {
  const normalizedDirectory = normalizeWorkspacePath(input.directory);
  if (!normalizedDirectory) {
    return null;
  }
  for (const workspace of input.workspaces ?? []) {
    if (normalizeWorkspacePath(workspace.workspaceDirectory) === normalizedDirectory) {
      return workspace;
    }
  }
  return null;
}

/**
 * Any live workspace belonging to the project rooted at `sourceDirectory`,
 * preferring one whose own directory *is* that root.
 *
 * Opening a file never justifies a workspace of its own, and matching on the
 * root alone is not enough to avoid one: a project whose only workspace is a
 * worktree has no workspace at the root, so the narrow lookup misses, creation
 * then succeeds (nothing occupies the root), and the user gets a second
 * workspace as a side effect of reading a README. Falling back to the worktree
 * opens the file in a workspace they already have, which is what they asked for.
 *
 * Workspaces mid-teardown are skipped: navigating into one that is being
 * archived is a dead end.
 */
export function findWorkspaceForProject(input: {
  workspaces: Iterable<WorkspaceDescriptor> | undefined;
  sourceDirectory: string;
}): WorkspaceDescriptor | null {
  const normalizedRoot = normalizeWorkspacePath(input.sourceDirectory);
  if (!normalizedRoot) {
    return null;
  }
  let sameProjectFallback: WorkspaceDescriptor | null = null;
  for (const workspace of input.workspaces ?? []) {
    if (workspace.archivingAt) {
      continue;
    }
    if (normalizeWorkspacePath(workspace.workspaceDirectory) === normalizedRoot) {
      return workspace;
    }
    if (
      !sameProjectFallback &&
      normalizeWorkspacePath(workspace.projectRootPath) === normalizedRoot
    ) {
      sameProjectFallback = workspace;
    }
  }
  return sameProjectFallback;
}

/** Re-resolves a workspace the steer already identified, by id. */
export function findWorkspaceById(input: {
  workspaces: Iterable<WorkspaceDescriptor> | undefined;
  workspaceId: string;
}): WorkspaceDescriptor | null {
  for (const workspace of input.workspaces ?? []) {
    if (workspace.id === input.workspaceId) {
      return workspace;
    }
  }
  return null;
}
