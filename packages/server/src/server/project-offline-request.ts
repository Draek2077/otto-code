import type { SessionInboundMessage } from "./messages.js";
import type { ProjectRegistry, WorkspaceRegistry } from "./workspace-registry.js";
import type { AgentStorage } from "./agent/agent-storage.js";
import { assertProjectOnline, pathWithinRoot } from "./project-availability.js";

/** Otto-owned RPC boundary; no workspace handler may revive an Offline project. */
export async function assertOnlineProjectRequest(
  request: SessionInboundMessage,
  projects: ProjectRegistry,
  workspaces: WorkspaceRegistry,
  agents: AgentStorage,
): Promise<void> {
  // Host metadata and explicit project reconnection do not open the directory.
  if (
    [
      "project.root.relocate.request",
      "project.rename.request",
      "project.icon.get.request",
      "project.list.request",
      "fetch_workspaces_request",
      "subscribe_workspace_updates_request",
      "fetch_agents_request",
      "fetch_agent_history_request",
      "stop_agent_request",
      "cancel_agent_request",
      "agent.timeline.set_subscription.request",
    ].includes(request.type)
  )
    return;
  const projectIds = new Set<string>();
  const workspaceIds = new Set<string>();
  const agentIds = new Set<string>();
  const paths = new Set<string>();
  function collect(value: unknown): void {
    if (!value || typeof value !== "object") return;
    const fields = value as Record<string, unknown>;
    for (const [key, target] of [
      ["projectId", projectIds],
      ["workspaceId", workspaceIds],
      ["agentId", agentIds],
    ] as const) {
      if (typeof fields[key] === "string") target.add(fields[key]);
    }
    for (const key of [
      "cwd",
      "workingDir",
      "workingDirectory",
      "directory",
      "path",
      "rootPath",
      "repoRoot",
      "worktreePath",
      "sourceCwd",
    ]) {
      if (typeof fields[key] === "string") paths.add(fields[key]);
    }
    // Only structured addressing fields; never inspect prompts, file contents or metadata.
    for (const key of ["config", "source", "target", "filter"]) collect(fields[key]);
  }
  collect(request);
  if (!projectIds.size && !workspaceIds.size && !agentIds.size && !paths.size) return;
  for (const id of agentIds) {
    const agent = await agents.get(id);
    if (agent?.workspaceId) workspaceIds.add(agent.workspaceId);
    if (agent?.cwd) paths.add(agent.cwd);
  }
  for (const id of workspaceIds) {
    const workspace = await workspaces.get(id);
    if (workspace) projectIds.add(workspace.projectId);
  }
  for (const project of await projects.list()) {
    if (
      projectIds.has(project.projectId) ||
      (!project.archivedAt && [...paths].some((value) => pathWithinRoot(project.rootPath, value)))
    ) {
      assertProjectOnline(project);
    }
  }
}
