import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import { deriveSidebarStateBucket, type SidebarStateBucket } from "@/utils/sidebar-agent-state";

export interface WorkspaceAgentActivity {
  agentId: string;
  status: WorkspaceDescriptor["status"];
  enteredAt: Date | null;
  hasActiveChat?: boolean;
}
const PRIORITY: readonly SidebarStateBucket[] = [
  "needs_input",
  "failed",
  "attention",
  "running",
  "done",
];
export function workspaceStatusPriority(status: SidebarStateBucket): number {
  return PRIORITY.indexOf(status);
}
function activityStatus(agent: Agent): SidebarStateBucket {
  let status = agent.status;
  if (agent.turn.phase === "open") status = "running";
  else if (status === "running") status = "idle";
  return deriveSidebarStateBucket({
    status,
    pendingPermissionCount: agent.pendingPermissions.length,
    requiresAttention: agent.requiresAttention,
    attentionReason: agent.attentionReason,
  });
}
function replaces(
  current: WorkspaceAgentActivity | undefined,
  status: SidebarStateBucket,
  enteredAt: Date,
): boolean {
  if (!current) return true;
  const rank = workspaceStatusPriority(status) - workspaceStatusPriority(current.status);
  return rank < 0 || (rank === 0 && (current.enteredAt === null || enteredAt > current.enteredAt));
}
function reuse(
  old: WorkspaceAgentActivity | undefined,
  value: WorkspaceAgentActivity,
): WorkspaceAgentActivity {
  if (
    old?.agentId === value.agentId &&
    old.status === value.status &&
    Boolean(old.hasActiveChat) === Boolean(value.hasActiveChat)
  )
    return old;
  return value;
}

/** Presentation aggregation over Paseo's canonical agents, without changing their lifecycle or read state. */
export function buildWorkspaceAgentActivityIndex(
  agents: ReadonlyMap<string, Agent>,
  previous?: ReadonlyMap<string, WorkspaceAgentActivity>,
): Map<string, WorkspaceAgentActivity> {
  const next = new Map<string, WorkspaceAgentActivity>();
  const running = new Set<string>();
  for (const agent of agents.values()) {
    const parent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
    if (agent.archivedAt || !agent.workspaceId || !isWorkspaceRootAgent(agent, parent)) continue;
    const status = activityStatus(agent);
    if (status === "running") running.add(agent.workspaceId);
    const enteredAt = agent.attentionTimestamp ?? agent.updatedAt;
    if (!replaces(next.get(agent.workspaceId), status, enteredAt)) continue;
    next.set(agent.workspaceId, { agentId: agent.id, status, enteredAt });
  }
  for (const [id, activity] of next) {
    // Omit false so pre-existing presentation snapshots stay structurally stable.
    const hasActiveChat = running.has(id);
    const value = hasActiveChat ? { ...activity, hasActiveChat: true } : activity;
    next.set(id, reuse(previous?.get(id), value));
  }
  if (previous?.size === next.size && [...next].every(([id, value]) => previous.get(id) === value))
    return previous instanceof Map ? previous : new Map(previous);
  return next;
}
