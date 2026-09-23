import type { WorkspaceDescriptor } from "@/stores/session-store";

export type DesktopBadgeWorkspaceStatus = WorkspaceDescriptor["status"];

export function isWorkspaceActionableForDesktopBadge(status: DesktopBadgeWorkspaceStatus): boolean {
  return status === "attention" || status === "needs_input" || status === "failed";
}

export function deriveMacDockBadgeCountFromWorkspaceStatuses(
  statuses: readonly DesktopBadgeWorkspaceStatus[],
): number | undefined {
  const actionableCount = statuses.filter(isWorkspaceActionableForDesktopBadge).length;
  return actionableCount > 0 ? actionableCount : undefined;
}

export function selectDesktopAttentionSnapshots(
  sessions: Record<
    string,
    {
      hasHydratedAgents: boolean;
      hasHydratedWorkspaces: boolean;
      agents: ReadonlyMap<
        string,
        {
          archivedAt?: Date | null;
          requiresAttention?: boolean;
          pendingPermissions: readonly unknown[];
        }
      >;
      workspaces: ReadonlyMap<string, { id: string; status: DesktopBadgeWorkspaceStatus }>;
    }
  >,
): Array<{ serverId: string; agentIds: string[]; workspaceIds: string[] }> {
  const snapshots: Array<{ serverId: string; agentIds: string[]; workspaceIds: string[] }> = [];
  for (const [serverId, session] of Object.entries(sessions)) {
    if (!session.hasHydratedAgents || !session.hasHydratedWorkspaces) continue;
    const agentIds = Array.from(session.agents.entries())
      .filter(
        ([, agent]) =>
          !agent.archivedAt && (agent.requiresAttention || agent.pendingPermissions.length > 0),
      )
      .map(([agentId]) => agentId)
      .sort();
    const workspaceIds = Array.from(session.workspaces.values())
      .filter((workspace) => isWorkspaceActionableForDesktopBadge(workspace.status))
      .map((workspace) => workspace.id)
      .sort();
    snapshots.push({ serverId, agentIds, workspaceIds });
  }
  return snapshots.sort((a, b) => a.serverId.localeCompare(b.serverId));
}
