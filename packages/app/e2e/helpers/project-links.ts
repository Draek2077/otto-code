import { connectDaemonClient } from "./daemon-client-loader";

// Out-of-band access to the daemon's gated-multi-root project links
// (project.links.* RPCs, see packages/server/src/server/project-links.ts).
// Specs drive the linking UI where the flow under test needs it and use this
// client for deterministic setup/cleanup and daemon-side assertions.

export interface ProjectLinkEntry {
  projectAId: string;
  projectBId: string;
}

export interface ProjectLinksClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  listProjectLinks(): Promise<ProjectLinkEntry[]>;
  linkProjects(projectId: string, otherProjectId: string): Promise<ProjectLinkEntry[]>;
  unlinkProjects(projectId: string, otherProjectId: string): Promise<ProjectLinkEntry[]>;
}

export async function connectProjectLinksClient(): Promise<ProjectLinksClient> {
  return connectDaemonClient<ProjectLinksClient>({ clientIdPrefix: "project-links" });
}

/** Links are undirected — a pair matches in either stored order. */
export function linksContainPair(
  entries: ProjectLinkEntry[],
  projectId: string,
  otherProjectId: string,
): boolean {
  return entries.some(
    (entry) =>
      (entry.projectAId === projectId && entry.projectBId === otherProjectId) ||
      (entry.projectAId === otherProjectId && entry.projectBId === projectId),
  );
}
