import equal from "fast-deep-equal";
import {
  buildWorkspaceStructureProjects,
  type WorkspaceStructure,
  type WorkspaceStructureProject,
} from "@/projects/workspace-structure";
import type { DesktopBadgeWorkspaceStatus } from "@/utils/desktop-badge-state";
import type { WorkspaceChangeIndicator } from "@/hooks/use-settings/storage";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import type { ProjectDescriptor, WorkspaceDescriptor } from "../session-store";

export type { DesktopBadgeWorkspaceStatus } from "@/utils/desktop-badge-state";
export type { WorkspaceStructure, WorkspaceStructureProject } from "@/projects/workspace-structure";

export interface SessionsSnapshot {
  sessions: Record<
    string,
    {
      hasHydratedWorkspaces?: boolean;
      hasWorkspaceDirectorySnapshot?: boolean;
      workspaces: Map<string, WorkspaceDescriptor>;
      projects?: Map<string, ProjectDescriptor>;
    }
  >;
}

export interface SidebarOrderSnapshot {
  projectOrder: string[];
  workspaceOrderByProject: Record<string, string[]>;
}

const EMPTY_WORKSPACE_KEYS: string[] = [];
const EMPTY_WORKSPACE_STRUCTURE: WorkspaceStructure = { projects: [] };

export const workspaceEqualityFns = {
  identity: Object.is as (a: unknown, b: unknown) => boolean,
  deep: equal as (a: unknown, b: unknown) => boolean,
};

function applyStoredOrdering<T>(input: {
  items: T[];
  storedOrder: readonly string[];
  getKey: (item: T) => string;
}): T[] {
  if (input.items.length <= 1 || input.storedOrder.length === 0) {
    return input.items;
  }

  const itemByKey = new Map<string, T>();
  for (const item of input.items) {
    itemByKey.set(input.getKey(item), item);
  }

  const prunedOrder: string[] = [];
  const seen = new Set<string>();
  for (const key of input.storedOrder) {
    if (!itemByKey.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    prunedOrder.push(key);
  }

  if (prunedOrder.length === 0) {
    return input.items;
  }

  const orderedSet = new Set(prunedOrder);
  const ordered: T[] = [];
  let orderedIndex = 0;

  for (const item of input.items) {
    const key = input.getKey(item);
    if (!orderedSet.has(key)) {
      ordered.push(item);
      continue;
    }

    const targetKey = prunedOrder[orderedIndex] ?? key;
    orderedIndex += 1;
    ordered.push(itemByKey.get(targetKey) ?? item);
  }

  return ordered;
}

export function selectWorkspace(
  state: SessionsSnapshot,
  serverId: string | null,
  workspaceId: string | null,
): WorkspaceDescriptor | null {
  if (!serverId || !workspaceId) {
    return null;
  }
  const workspaces = state.sessions[serverId]?.workspaces;
  const workspaceKey = resolveWorkspaceMapKeyByIdentity({
    workspaces,
    workspaceId,
  });
  return workspaceKey ? (workspaces?.get(workspaceKey) ?? null) : null;
}

export function selectProjectDiffStat(
  state: SessionsSnapshot,
  workspaces: ReadonlyArray<{ serverId: string; workspaceId: string }>,
): { additions: number; deletions: number } | null {
  return selectProjectChangeStat(state, workspaces, "branch");
}

/**
 * Select the +/- stat displayed for one workspace. `uncommitted` is relative
 * to HEAD (and includes untracked files); `branch` is relative to its resolved
 * base; `hidden` suppresses the indicator entirely.
 */
export function selectWorkspaceChangeStat(
  workspace: Pick<WorkspaceDescriptor, "workingTreeDiffStat" | "diffStat">,
  indicator: WorkspaceChangeIndicator,
): { additions: number; deletions: number } | null {
  switch (indicator) {
    case "uncommitted":
      return workspace.workingTreeDiffStat ?? null;
    case "branch":
      return workspace.diffStat;
    case "hidden":
      return null;
  }
}

/**
 * The UI never renders an empty +/- badge. Keep that presentation rule beside
 * the mode selector so every workspace-level indicator agrees on both its
 * comparison base and whether it has anything to show.
 */
export function selectVisibleWorkspaceChangeStat(
  workspace: Pick<WorkspaceDescriptor, "workingTreeDiffStat" | "diffStat">,
  indicator: WorkspaceChangeIndicator,
): { additions: number; deletions: number } | null {
  const diffStat = selectWorkspaceChangeStat(workspace, indicator);
  return diffStat && (diffStat.additions > 0 || diffStat.deletions > 0) ? diffStat : null;
}

/**
 * Aggregate the same mode-specific +/- stat used by workspace rows. This keeps
 * a project header from silently falling back to branch-versus-base totals.
 */
export function selectProjectChangeStat(
  state: SessionsSnapshot,
  workspaces: ReadonlyArray<{ serverId: string; workspaceId: string }>,
  indicator: WorkspaceChangeIndicator,
): { additions: number; deletions: number } | null {
  if (indicator === "hidden") {
    return null;
  }

  let additions = 0;
  let deletions = 0;
  let hasDiffStat = false;
  for (const { serverId, workspaceId } of workspaces) {
    const workspace = selectWorkspace(state, serverId, workspaceId);
    const diffStat = workspace ? selectWorkspaceChangeStat(workspace, indicator) : null;
    if (!diffStat) continue;
    hasDiffStat = true;
    additions += diffStat.additions;
    deletions += diffStat.deletions;
  }
  return hasDiffStat ? { additions, deletions } : null;
}

export function selectWorkspaceFields<T>(
  state: SessionsSnapshot,
  serverId: string | null,
  workspaceId: string | null,
  project: (w: WorkspaceDescriptor) => T,
): T | null {
  const workspace = selectWorkspace(state, serverId, workspaceId);
  return workspace ? project(workspace) : null;
}

export function selectWorkspaceDirectory(
  state: SessionsSnapshot,
  serverId: string | null,
  workspaceId: string | null,
): string | null {
  return selectWorkspace(state, serverId, workspaceId)?.workspaceDirectory || null;
}

/**
 * The workspace's project grouping key (`WorkspaceDescriptor.projectId`) - a
 * repo-remote key like `remote:host/owner/repo` when the repo has a git
 * remote, otherwise a filesystem path (main repo root, or cwd for non-git).
 * Distinct from `workspaceDirectory`/`projectRootPath`, which are always
 * real paths: this is the opaque id worktrees of the same repo share, and
 * the same value the server stamps onto artifacts via `create_artifact`'s
 * `resolveArtifactProjectId`. Compare artifact.projectId against this with
 * `artifactBelongsToProject`, never against a cwd/path.
 */
export function selectWorkspaceProjectId(
  state: SessionsSnapshot,
  serverId: string | null,
  workspaceId: string | null,
): string | null {
  return selectWorkspace(state, serverId, workspaceId)?.projectId || null;
}

export function selectWorkspaceExists(
  state: SessionsSnapshot,
  serverId: string | null,
  workspaceId: string | null,
): boolean {
  return selectWorkspace(state, serverId, workspaceId) !== null;
}

export function selectHasHydratedWorkspaces(
  state: SessionsSnapshot,
  serverId: string | null,
): boolean {
  return serverId ? (state.sessions[serverId]?.hasHydratedWorkspaces ?? false) : false;
}

export function selectHydratedWorkspaceServerIds(
  state: SessionsSnapshot,
  serverIds: readonly string[],
): string[] {
  return serverIds.filter((serverId) => state.sessions[serverId]?.hasHydratedWorkspaces === true);
}

export function selectWorkspaceDirectoryServerIds(
  state: SessionsSnapshot,
  serverIds: readonly string[],
): string[] {
  return serverIds.filter((serverId) => {
    const session = state.sessions[serverId];
    return (
      session?.hasHydratedWorkspaces === true || session?.hasWorkspaceDirectorySnapshot === true
    );
  });
}

export function selectWorkspaceStructureProjects(
  state: SessionsSnapshot,
  serverIds: readonly string[],
): WorkspaceStructureProject[] {
  const sessions: Array<{
    serverId: string;
    workspaces: Iterable<WorkspaceDescriptor>;
    projects: Iterable<ProjectDescriptor>;
  }> = [];

  for (const serverId of serverIds) {
    const session = state.sessions[serverId];
    const workspaces = session?.workspaces;
    const projects = session?.projects;
    if (!projects || projects.size === 0) {
      continue;
    }
    sessions.push({
      serverId,
      workspaces: workspaces?.values() ?? [],
      projects: projects.values(),
    });
  }

  if (sessions.length === 0) {
    return EMPTY_WORKSPACE_STRUCTURE.projects;
  }

  return buildWorkspaceStructureProjects({ sessions });
}

export function createWorkspaceStructureProjectsSelector(
  serverIds: readonly string[],
): (state: SessionsSnapshot) => WorkspaceStructureProject[] {
  let previousInputs: Array<{
    workspaces: Map<string, WorkspaceDescriptor> | undefined;
    projects: Map<string, ProjectDescriptor> | undefined;
  }> | null = null;
  let previousProjects: WorkspaceStructureProject[] | null = null;

  return (state) => {
    const inputs = serverIds.map((serverId) => ({
      workspaces: state.sessions[serverId]?.workspaces,
      projects: state.sessions[serverId]?.projects,
    }));
    const priorInputs = previousInputs;
    const unchanged =
      priorInputs !== null &&
      inputs.every(
        (input, index) =>
          input.workspaces === priorInputs[index]?.workspaces &&
          input.projects === priorInputs[index]?.projects,
      );
    if (unchanged && previousProjects) {
      return previousProjects;
    }

    previousInputs = inputs;
    previousProjects = selectWorkspaceStructureProjects(state, serverIds);
    return previousProjects;
  };
}

export function selectProject(
  state: SessionsSnapshot,
  serverId: string | null,
  projectId: string | null,
): ProjectDescriptor | null {
  if (!serverId || !projectId) return null;
  return state.sessions[serverId]?.projects?.get(projectId) ?? null;
}

export function selectProjectIdForServer(
  state: SessionsSnapshot,
  input: {
    sourceServerId: string;
    projectId: string;
    targetServerId: string;
  },
): string | null {
  if (input.sourceServerId === input.targetServerId) return input.projectId;
  const source = selectProject(state, input.sourceServerId, input.projectId);
  if (!source?.projectKey) return null;
  for (const project of state.sessions[input.targetServerId]?.projects?.values() ?? []) {
    if (project.projectKey === source.projectKey) return project.projectId;
  }
  return null;
}

export function selectProjectOrder(state: SidebarOrderSnapshot): string[] {
  return state.projectOrder ?? EMPTY_WORKSPACE_KEYS;
}

export function selectWorkspaceOrderByScope(state: SidebarOrderSnapshot): Record<string, string[]> {
  return state.workspaceOrderByProject ?? {};
}

export function composeWorkspaceStructure(input: {
  projects: WorkspaceStructureProject[];
  projectOrder: readonly string[];
  workspaceOrderByScope: Record<string, readonly string[]>;
}): WorkspaceStructure {
  if (input.projects.length === 0) {
    return EMPTY_WORKSPACE_STRUCTURE;
  }

  const orderedProjects = applyStoredOrdering({
    items: input.projects.map((project) => {
      const workspaceOrder = input.workspaceOrderByScope[project.viewKey] ?? EMPTY_WORKSPACE_KEYS;
      return {
        ...project,
        workspaceKeys: applyStoredOrdering({
          items: project.workspaceKeys,
          storedOrder: workspaceOrder,
          getKey: (workspaceKey) => workspaceKey,
        }),
      };
    }),
    storedOrder: input.projectOrder,
    getKey: (project) => project.viewKey,
  });

  return { projects: orderedProjects };
}

export function selectWorkspaceKeys(state: SessionsSnapshot, serverId: string | null): string[] {
  if (!serverId) {
    return EMPTY_WORKSPACE_KEYS;
  }
  const workspaces = state.sessions[serverId]?.workspaces;
  return workspaces ? Array.from(workspaces.keys()) : EMPTY_WORKSPACE_KEYS;
}

export function selectRecommendedProjectPaths(
  state: SessionsSnapshot,
  serverId: string | null,
): string[] {
  if (!serverId) {
    return EMPTY_WORKSPACE_KEYS;
  }
  const workspaces = state.sessions[serverId]?.workspaces;
  if (!workspaces) {
    return EMPTY_WORKSPACE_KEYS;
  }
  return Array.from(workspaces.values())
    .map((workspace) => workspace.projectRootPath)
    .filter((path) => path.length > 0);
}

export function selectHasWorkspaces(state: SessionsSnapshot, serverId: string | null): boolean {
  if (!serverId) {
    return false;
  }
  return (state.sessions[serverId]?.workspaces?.size ?? 0) > 0;
}

export function selectWorkspaceStatusesForBadges(
  state: SessionsSnapshot,
): DesktopBadgeWorkspaceStatus[] {
  const statuses: DesktopBadgeWorkspaceStatus[] = [];
  for (const session of Object.values(state.sessions)) {
    for (const workspace of session.workspaces.values()) {
      statuses.push(workspace.status);
    }
  }
  return statuses;
}
