import { queryClient } from "@/data/query-client";
import { isAgentArchiving } from "@/hooks/use-archive-agent";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { useClearedSubagentTokensStore } from "@/subagents/cleared-subagent-tokens-store";
import type { PendingPermission } from "@/types/shared";
import { derivePendingPermissionKey } from "@/utils/agent-snapshots";
import { traceCaptureSync } from "@/diagnostics/resource-report/capture-operations";

export function traceOttoAgentDirectoryDelta<T>(
  serverId: string,
  agentId: string,
  apply: () => T,
): T {
  return traceCaptureSync("agent.directory.apply", apply, { serverId, agentId });
}

export function isOttoArchiveSnapshotPending(serverId: string, incoming: Agent): boolean {
  return !incoming.archivedAt && isAgentArchiving({ queryClient, serverId, agentId: incoming.id });
}

/** A fetch begun before Clear cannot undo the optimistic archive on completion. */
export function preserveOttoPendingArchives(
  serverId: string,
  current: ReadonlyMap<string, Agent>,
  fetched: Map<string, Agent>,
  pendingPermissions: Map<string, PendingPermission>,
): ReadonlySet<string> {
  const suppressed = new Set<string>();
  for (const [agentId, existing] of current) {
    const incoming = fetched.get(agentId);
    if (!incoming || !existing.archivedAt || !isOttoArchiveSnapshotPending(serverId, incoming)) {
      continue;
    }
    fetched.set(agentId, existing);
    suppressed.add(agentId);
    for (const [key, pending] of pendingPermissions) {
      if (pending.agentId === agentId) pendingPermissions.delete(key);
    }
    for (const request of existing.pendingPermissions) {
      const key = derivePendingPermissionKey(agentId, request);
      pendingPermissions.set(key, { key, agentId, request });
    }
  }
  return suppressed;
}

export function releaseOttoAgentPresentation(serverId: string, agentId: string): void {
  useSessionStore.getState().releaseAgentStreams(serverId, [agentId]);
  useClearedSubagentTokensStore.getState().resetForParent({ serverId, parentAgentId: agentId });
}
