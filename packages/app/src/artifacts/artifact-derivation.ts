import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import { normalizeWorkspaceOpaqueId, normalizeWorkspacePath } from "@/utils/workspace-identity";

/** Sort artifacts: starred first, then alphabetically by name. Generic so the
 * host-tagged `AggregatedArtifact` shape flows through unchanged.
 *
 * Deliberately not `updatedAt`: the store bumps `updatedAt` on every field
 * change, including starring/unstarring itself — sorting by recency made
 * unstarring an artifact look like a no-op, since it was still the most
 * recently touched item and stayed pinned at the top of the unstarred group. */
export function sortArtifacts<T extends ArtifactMetadata>(artifacts: T[]): T[] {
  return [...artifacts].sort((a, b) => {
    if (a.starred !== b.starred) {
      return a.starred ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/**
 * Whether an artifact's stored project (repo root) corresponds to a workspace
 * directory. Compares normalized paths in both directions so a workspace whose
 * cwd is a worktree under the repo root — or the repo root itself — still
 * matches, regardless of OS-native separators. An empty/unknown projectId or
 * cwd never matches.
 */
export function artifactBelongsToWorkspace(
  artifactProjectId: string,
  workspaceCwd: string | null | undefined,
): boolean {
  const projectId = normalizeWorkspacePath(artifactProjectId);
  const cwd = normalizeWorkspacePath(workspaceCwd);
  if (!projectId || !cwd) {
    return false;
  }
  return projectId === cwd || cwd.startsWith(`${projectId}/`) || projectId.startsWith(`${cwd}/`);
}

/**
 * Whether an artifact's stored project matches a workspace's project
 * grouping key (`WorkspaceDescriptor.projectId`) — a repo-remote key like
 * `remote:host/owner/repo` when the repo has a git remote, otherwise a
 * filesystem path. This is a plain opaque-id equality check, unlike
 * `artifactBelongsToWorkspace`'s path comparison: worktrees of the same repo
 * already collapse onto the same grouping key server-side, so no
 * prefix/path matching is needed here.
 */
export function artifactBelongsToProject(
  artifactProjectId: string,
  workspaceProjectId: string | null | undefined,
): boolean {
  const a = normalizeWorkspaceOpaqueId(artifactProjectId);
  const b = normalizeWorkspaceOpaqueId(workspaceProjectId);
  if (!a || !b) {
    return false;
  }
  return a === b;
}

/**
 * Whether an artifact belongs to a workspace, given both the workspace's cwd
 * and its project grouping key. Artifacts canonically store the project's
 * root *path* as projectId (what the create sheet and — since the
 * create_artifact fix — the agent tool both write), so the path comparison
 * is the primary match.
 */
export function artifactMatchesWorkspace(input: {
  artifactProjectId: string;
  workspaceCwd: string | null | undefined;
  workspaceProjectId: string | null | undefined;
}): boolean {
  if (artifactBelongsToWorkspace(input.artifactProjectId, input.workspaceCwd)) {
    return true;
  }
  // COMPAT(artifactGroupingKeyProjectId): until 0.4.4 create_artifact stamped
  // artifacts with the registry's opaque grouping key (remote:host/owner/repo)
  // instead of the project root path. Persisted artifacts keep that value
  // forever (no migrations), so also accept a grouping-key match. Drop when
  // pre-0.4.5 artifacts no longer matter (~2027-01).
  return artifactBelongsToProject(input.artifactProjectId, input.workspaceProjectId);
}

/** Filter artifacts by project. Returns all artifacts when projectId is undefined. */
export function filterByProject<T extends ArtifactMetadata>(
  artifacts: T[],
  projectId?: string,
): T[] {
  if (projectId === undefined) {
    return artifacts;
  }
  return artifacts.filter((artifact) => artifact.projectId === projectId);
}
