import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import {
  type ProjectDescriptor,
  normalizeProjectDescriptor,
  normalizeWorkspaceDescriptor,
  type WorkspaceDescriptor,
} from "@/stores/session-store";

export type FetchWorkspacesClient = Pick<DaemonClient, "fetchWorkspaces">;
export type FetchWorkspacesSort = NonNullable<
  Parameters<DaemonClient["fetchWorkspaces"]>[0]
>["sort"];

export interface FetchWorkspaceDescriptorsResult {
  workspaces: WorkspaceDescriptor[];
  /**
   * Project parents with no active workspaces. The daemon only rides these on
   * the first page of `fetchWorkspaces`, so a freshly-added project that has no
   * workspace yet shows up here and nowhere else — drop it and the project is
   * invisible to anything that derives projects from workspaces alone.
   */
  emptyProjects: ProjectDescriptor[];
}

export async function fetchAllWorkspaceDescriptors(input: {
  client: FetchWorkspacesClient;
  sort: FetchWorkspacesSort;
}): Promise<FetchWorkspaceDescriptorsResult> {
  const workspaces: WorkspaceDescriptor[] = [];
  const emptyProjects = new Map<string, ProjectDescriptor>();
  let cursor: string | null = null;

  while (true) {
    const payload = await input.client.fetchWorkspaces({
      sort: input.sort,
      page: cursor ? { limit: 200, cursor } : { limit: 200 },
    });
    workspaces.push(...payload.entries.map((entry) => normalizeWorkspaceDescriptor(entry)));
    for (const project of payload.emptyProjects ?? []) {
      const descriptor = normalizeProjectDescriptor(project);
      emptyProjects.set(descriptor.projectId, descriptor);
    }
    if (!payload.pageInfo.hasMore || !payload.pageInfo.nextCursor) {
      break;
    }
    cursor = payload.pageInfo.nextCursor;
  }

  return { workspaces, emptyProjects: Array.from(emptyProjects.values()) };
}
