import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";

/** Sort artifacts: starred first, then by updatedAt descending. Generic so the
 * host-tagged `AggregatedArtifact` shape flows through unchanged. */
export function sortArtifacts<T extends ArtifactMetadata>(artifacts: T[]): T[] {
  return [...artifacts].sort((a, b) => {
    if (a.starred !== b.starred) {
      return a.starred ? -1 : 1;
    }
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
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
