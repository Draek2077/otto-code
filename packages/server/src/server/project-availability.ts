import { statSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import type {
  PersistedProjectRecord,
  ProjectRegistry,
  WorkspaceRegistry,
} from "./workspace-registry.js";

const relocationWrites = new AsyncLocalStorage<string>();
export function withProjectRelocationWrites<T>(
  projectId: string,
  action: () => Promise<T>,
): Promise<T> {
  return relocationWrites.run(projectId, action);
}

export function protectOfflineWorkspaceRecords(
  projects: ProjectRegistry,
  workspaces: WorkspaceRegistry,
): void {
  workspaces.setMutationGuard?.(async (record) => {
    if (relocationWrites.getStore() === record.projectId) return;
    const project = await projects.get(record.projectId);
    if (project) assertProjectOnline(project);
  });
}

/** Otto-owned availability boundary. A missing root is never an archive instruction. */
export function isProjectOffline(project: PersistedProjectRecord): boolean {
  if (project.offline) return true;
  try {
    return !statSync(project.rootPath).isDirectory();
  } catch {
    return true;
  }
}

export function assertProjectOnline(project: PersistedProjectRecord): void {
  if (isProjectOffline(project)) {
    throw new Error(
      `Project is Offline. Edit its base folder to reconnect it: ${project.rootPath}`,
    );
  }
}

export function pathWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

export function relocateProjectPath(value: string, oldRoot: string, newRoot: string): string {
  return pathWithinRoot(oldRoot, value) ? path.join(newRoot, path.relative(oldRoot, value)) : value;
}

export async function observeOfflineProjects(projectRegistry: ProjectRegistry): Promise<void> {
  for (const project of await projectRegistry.list()) {
    if (!project.archivedAt && !project.offline && isProjectOffline(project)) {
      await projectRegistry.update(project.projectId, (current) =>
        isProjectOffline(current) ? { ...current, offline: true } : current,
      );
    }
  }
}

export async function assertProjectPathOnline(
  projectRegistry: ProjectRegistry,
  cwd: string,
): Promise<void> {
  for (const project of await projectRegistry.list()) {
    if (!project.archivedAt && pathWithinRoot(project.rootPath, cwd)) assertProjectOnline(project);
  }
}

export async function assertWorkspaceProjectOnline(
  projectRegistry: ProjectRegistry,
  workspaceRegistry: WorkspaceRegistry,
  workspaceId: string,
): Promise<void> {
  const workspace = await workspaceRegistry.get(workspaceId);
  const project = workspace && (await projectRegistry.get(workspace.projectId));
  if (project) assertProjectOnline(project);
}
