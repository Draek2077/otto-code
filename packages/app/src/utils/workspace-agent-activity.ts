import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import { deriveSidebarStateBucket, getWorkspaceStatusDotPriority } from "./sidebar-agent-state";

export interface WorkspaceAgentActivity {
  agentId: string;
  status: WorkspaceDescriptor["status"];
  enteredAt: Date | null;
  /** True while any root chat belonging to this workspace is actively running. */
  hasActiveChat: boolean;
}

export function buildWorkspaceAgentActivityIndex(
  agents: ReadonlyMap<string, Agent>,
  previous?: ReadonlyMap<string, WorkspaceAgentActivity>,
): Map<string, WorkspaceAgentActivity> {
  const activityByWorkspaceId = new Map<string, WorkspaceAgentActivity>();
  const activeChatWorkspaceIds = new Set<string>();

  for (const agent of agents.values()) {
    const parentAgent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
    if (agent.archivedAt || !agent.workspaceId || !isWorkspaceRootAgent(agent, parentAgent)) {
      continue;
    }

    const status = deriveSidebarStateBucket({
      status: agent.status,
      pendingPermissionCount: agent.pendingPermissions.length,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason,
    });
    if (status === "running") {
      activeChatWorkspaceIds.add(agent.workspaceId);
    }

    const enteredAt = agent.attentionTimestamp ?? agent.updatedAt;
    if (
      !shouldReplaceWorkspaceStatus({
        current: activityByWorkspaceId.get(agent.workspaceId),
        candidateStatus: status,
        candidateEnteredAt: enteredAt,
      })
    ) {
      continue;
    }
    activityByWorkspaceId.set(agent.workspaceId, {
      agentId: agent.id,
      status,
      enteredAt,
      hasActiveChat: false,
    });
  }

  for (const [workspaceId, activity] of activityByWorkspaceId) {
    activityByWorkspaceId.set(workspaceId, {
      ...activity,
      hasActiveChat: activeChatWorkspaceIds.has(workspaceId),
    });
  }

  for (const [workspaceId, activity] of activityByWorkspaceId) {
    const previousActivity = previous?.get(workspaceId);
    if (
      previousActivity?.agentId === activity.agentId &&
      previousActivity.status === activity.status &&
      previousActivity.hasActiveChat === activity.hasActiveChat
    ) {
      activityByWorkspaceId.set(workspaceId, previousActivity);
    }
  }

  if (previous && areWorkspaceAgentActivityIndexesIdentical(previous, activityByWorkspaceId)) {
    return previous instanceof Map ? previous : new Map(previous);
  }
  return activityByWorkspaceId;
}

function shouldReplaceWorkspaceStatus(input: {
  current: WorkspaceAgentActivity | undefined;
  candidateStatus: WorkspaceDescriptor["status"];
  candidateEnteredAt: Date;
}): boolean {
  if (!input.current) return true;

  const candidatePriority = getWorkspaceStatusDotPriority(input.candidateStatus);
  const currentPriority = getWorkspaceStatusDotPriority(input.current.status);
  if (candidatePriority !== currentPriority) {
    return candidatePriority < currentPriority;
  }

  return input.current.enteredAt === null || input.candidateEnteredAt > input.current.enteredAt;
}

function areWorkspaceAgentActivityIndexesIdentical(
  previous: ReadonlyMap<string, WorkspaceAgentActivity>,
  next: ReadonlyMap<string, WorkspaceAgentActivity>,
): boolean {
  if (previous.size !== next.size) {
    return false;
  }
  for (const [workspaceId, activity] of next) {
    if (previous.get(workspaceId) !== activity) {
      return false;
    }
  }
  return true;
}
