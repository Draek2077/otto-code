import type { WorkspaceDescriptor } from "@/stores/session-store";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";

/**
 * The workspaces of a selected project that an orchestration can run in.
 *
 * The project picker chooses a repo root; a project usually holds more than one
 * workspace (the checkout itself plus its worktrees), and the run has to land in
 * exactly one of them. Workspaces are matched by `projectId` — the same key the
 * project list groups on — so a worktree whose directory lives outside the repo
 * root still belongs to its project.
 */

export const PROJECT_ROOT_WORKSPACE_ID = "__project-root__";

export interface OrchestrationWorkspaceTarget {
  /** Workspace id, or PROJECT_ROOT_WORKSPACE_ID for the synthetic root entry. */
  id: string;
  name: string;
  cwd: string;
  isProjectRoot: boolean;
  branch: string | null;
}

interface BuildInput {
  workspaces: ReadonlyMap<string, WorkspaceDescriptor> | undefined;
  /** The selected project, or null while none is chosen. */
  project: { projectKey: string; cwd: string } | null;
}

export function buildOrchestrationWorkspaceTargets(
  input: BuildInput,
): OrchestrationWorkspaceTarget[] {
  const projectRoot = normalizeWorkspacePath(input.project?.cwd);
  if (!input.project || !projectRoot) {
    return [];
  }

  const targets: OrchestrationWorkspaceTarget[] = [];
  let hasRootEntry = false;
  for (const workspace of input.workspaces?.values() ?? []) {
    if (workspace.projectId !== input.project.projectKey || workspace.archivingAt) {
      continue;
    }
    const cwd = workspace.workspaceDirectory.trim();
    if (!cwd) {
      continue;
    }
    const isProjectRoot = normalizeWorkspacePath(cwd) === projectRoot;
    hasRootEntry ||= isProjectRoot;
    targets.push({
      id: workspace.id,
      name: workspace.name,
      cwd,
      isProjectRoot,
      branch: workspace.gitRuntime?.currentBranch ?? null,
    });
  }

  targets.sort((left, right) => {
    if (left.isProjectRoot !== right.isProjectRoot) {
      return left.isProjectRoot ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });

  // A project whose root is not itself an open workspace still runs there —
  // the daemon opens it on demand — so the root is always offered.
  if (!hasRootEntry) {
    targets.unshift({
      id: PROJECT_ROOT_WORKSPACE_ID,
      name: "Project root",
      cwd: input.project.cwd.trim(),
      isProjectRoot: true,
      branch: null,
    });
  }

  return targets;
}

/**
 * The project a known workspace directory belongs to. An Otto worktree lives
 * outside its repo root, so path containment cannot answer this — the
 * workspace's own `projectId` can.
 */
export function resolveProjectKeyForWorkspaceCwd(
  workspaces: ReadonlyMap<string, WorkspaceDescriptor> | undefined,
  cwd: string,
): string | null {
  const normalized = normalizeWorkspacePath(cwd);
  if (!normalized) {
    return null;
  }
  for (const workspace of workspaces?.values() ?? []) {
    if (normalizeWorkspacePath(workspace.workspaceDirectory) === normalized) {
      return workspace.projectId;
    }
  }
  return null;
}

export function resolveSelectedWorkspaceTarget(
  targets: readonly OrchestrationWorkspaceTarget[],
  cwd: string,
): OrchestrationWorkspaceTarget | null {
  const normalized = normalizeWorkspacePath(cwd);
  if (!normalized) {
    return null;
  }
  return targets.find((target) => normalizeWorkspacePath(target.cwd) === normalized) ?? null;
}
