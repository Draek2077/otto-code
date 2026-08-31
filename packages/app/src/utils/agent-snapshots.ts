import type { AgentSnapshotPayload } from "@otto-code/protocol/messages";
import type { AgentPermissionRequest } from "@otto-code/protocol/agent-types";
import { getParentAgentIdFromLabels } from "@otto-code/protocol/agent-labels";
import type { ActiveTurnIdentity } from "@/timeline/turn-liveness";
import { type Agent } from "@/stores/session-store";

export function normalizeAgentActiveTurn(
  snapshot: AgentSnapshotPayload,
  lastUserMessageAt: Date | null,
): ActiveTurnIdentity | null {
  if (snapshot.activeTurn === null) return null;
  if (snapshot.activeTurn) {
    return {
      turnId: snapshot.activeTurn.turnId,
      startedAt: snapshot.activeTurn.startedAt ? new Date(snapshot.activeTurn.startedAt) : null,
    };
  }
  // COMPAT(agentTurnIdentity): added in v0.2.6, remove after 2027-01-31 once daemon floor >= v0.2.6.
  // Old daemons expose only status. Normalize that legacy signal once at the
  // snapshot boundary; the Agent replica itself never owns turn liveness.
  return snapshot.status === "running" ? { turnId: null, startedAt: lastUserMessageAt } : null;
}

export function derivePendingPermissionKey(
  agentId: string,
  request: AgentPermissionRequest,
): string {
  const fallbackId =
    request.id ||
    (typeof request.metadata?.id === "string" ? request.metadata.id : undefined) ||
    request.name ||
    request.title ||
    `${request.kind}:${JSON.stringify(request.input ?? request.metadata ?? {})}`;

  return `${agentId}:${fallbackId}`;
}

/**
 * COMPAT(agentProfileFields): added in v0.8.13, remove after 2027-02-22. The
 * daemon emits the bound Agent Profile's identity under both spellings.
 * Preferring the current one here, at the single ingestion point, is what lets
 * every reader downstream keep one field name; a daemon older than the rename
 * sends only the legacy trio, which is what the fallback covers.
 */
function resolveProfileIdentity(snapshot: AgentSnapshotPayload) {
  return {
    personalitySpinner: snapshot.agentProfileSpinner ?? snapshot.personalitySpinner ?? null,
    personalityName: snapshot.agentProfileName ?? snapshot.personalityName ?? null,
    personalityId: snapshot.agentProfileId ?? snapshot.personalityId ?? null,
  };
}

export function normalizeAgentSnapshot(snapshot: AgentSnapshotPayload, serverId: string) {
  const createdAt = new Date(snapshot.createdAt);
  const updatedAt = new Date(snapshot.updatedAt);
  const lastUserMessageAt = snapshot.lastUserMessageAt
    ? new Date(snapshot.lastUserMessageAt)
    : null;
  const attentionTimestamp = snapshot.attentionTimestamp
    ? new Date(snapshot.attentionTimestamp)
    : null;
  const archivedAt = snapshot.archivedAt ? new Date(snapshot.archivedAt) : null;
  const parentAgentId = getParentAgentIdFromLabels(snapshot.labels);
  return {
    serverId,
    id: snapshot.id,
    provider: snapshot.provider,
    status: snapshot.status,
    createdAt,
    updatedAt,
    lastUserMessageAt,
    lastActivityAt: updatedAt,
    capabilities: snapshot.capabilities,
    currentModeId: snapshot.currentModeId,
    availableModes: snapshot.availableModes ?? [],
    pendingPermissions: snapshot.pendingPermissions ?? [],
    persistence: snapshot.persistence ?? null,
    runtimeInfo: snapshot.runtimeInfo,
    lastUsage: snapshot.lastUsage,
    cumulativeTokens: snapshot.cumulativeTokens,
    cumulativeUsage: snapshot.cumulativeUsage,
    toolUseCount: snapshot.toolUseCount,
    currentTool: snapshot.currentTool,
    queuedMessages: snapshot.queuedMessages,
    lastError: snapshot.lastError ?? null,
    title: snapshot.title ?? null,
    cwd: snapshot.cwd,
    workspaceId: snapshot.workspaceId,
    model: snapshot.model ?? null,
    features: snapshot.features,
    thinkingOptionId: snapshot.thinkingOptionId ?? null,
    requiresAttention: snapshot.requiresAttention ?? false,
    attentionReason: snapshot.attentionReason ?? null,
    attentionTimestamp,
    archivedAt,
    archiveBytes: snapshot.archiveBytes,
    parentAgentId,
    labels: snapshot.labels,
    attend: snapshot.attend ?? "attended",
    backgrounded: snapshot.backgrounded ?? false,
    ...resolveProfileIdentity(snapshot),
  };
}

export function projectAgentSnapshot(agent: Agent): AgentSnapshotPayload {
  return {
    id: agent.id,
    provider: agent.provider,
    cwd: agent.cwd,
    ...(agent.workspaceId ? { workspaceId: agent.workspaceId } : {}),
    model: agent.model,
    ...(agent.features ? { features: agent.features } : {}),
    thinkingOptionId: agent.thinkingOptionId ?? null,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
    lastUserMessageAt: agent.lastUserMessageAt?.toISOString() ?? null,
    status: agent.status,
    ...projectActiveTurn(agent),
    capabilities: agent.capabilities,
    currentModeId: agent.currentModeId,
    availableModes: agent.availableModes,
    pendingPermissions: agent.pendingPermissions,
    persistence: agent.persistence,
    ...(agent.runtimeInfo ? { runtimeInfo: agent.runtimeInfo } : {}),
    ...(agent.lastUsage ? { lastUsage: agent.lastUsage } : {}),
    ...(agent.lastError ? { lastError: agent.lastError } : {}),
    title: agent.title,
    labels: agent.labels,
    requiresAttention: agent.requiresAttention ?? false,
    attentionReason: agent.attentionReason ?? null,
    attentionTimestamp: agent.attentionTimestamp?.toISOString() ?? null,
    archivedAt: agent.archivedAt?.toISOString() ?? null,
  };
}

function projectActiveTurn(agent: Agent): Pick<AgentSnapshotPayload, "activeTurn"> {
  // Absent on a daemon that does not report turn identity: leave the field off
  // the payload rather than asserting the agent is between turns.
  if (agent.activeTurn === undefined) return {};
  if (agent.activeTurn === null) return { activeTurn: null };
  if (agent.activeTurn.turnId === null) return {};
  return {
    activeTurn: {
      turnId: agent.activeTurn.turnId,
      startedAt: agent.activeTurn.startedAt?.toISOString() ?? null,
    },
  };
}
