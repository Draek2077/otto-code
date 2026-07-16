import { usePendingArchiveAgentIds } from "@/hooks/use-archive-agent";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useSessionStore, type Agent } from "@/stores/session-store";

export interface SubagentRow {
  id: Agent["id"];
  provider: Agent["provider"];
  title: Agent["title"];
  status: Agent["status"];
  requiresAttention: Agent["requiresAttention"];
  createdAt: Agent["createdAt"];
  updatedAt: Agent["updatedAt"];
  attend?: Agent["attend"];
  cumulativeTokens?: Agent["cumulativeTokens"];
  personalityName?: Agent["personalityName"];
  personalitySpinner?: Agent["personalitySpinner"];
}

type SessionStoreSnapshot = ReturnType<typeof useSessionStore.getState>;

interface SelectSubagentsParams {
  serverId: string;
  parentAgentId: string;
}

const EMPTY_SUBAGENT_ROWS: SubagentRow[] = [];

function toSubagentRow(agent: Agent): SubagentRow {
  return {
    id: agent.id,
    provider: agent.provider,
    title: agent.title,
    status: agent.status,
    requiresAttention: agent.requiresAttention,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    attend: agent.attend,
    cumulativeTokens: agent.cumulativeTokens,
    personalityName: agent.personalityName,
    personalitySpinner: agent.personalitySpinner,
  };
}

/** Backstop against a parent-id cycle in corrupt data; real nesting is a few
 * levels deep at most (chat -> subagent -> its own subagents). */
const MAX_PARENT_WALK_DEPTH = 8;

/**
 * True when `agent` belongs in the track of `parentAgentId`: a direct child,
 * or a nested observed subagent reached by walking up THROUGH observed rows
 * only (a subagent's own fan-out parents to its spawning subagent's row, and
 * that whole tree is this chat's doing). An ATTENDED intermediate breaks the
 * chain on purpose — an attended child is its own chat with its own track,
 * and its children are not this chat's rows.
 */
function isTrackDescendantOf(
  agent: Agent,
  parentAgentId: string,
  agentsById: ReadonlyMap<string, Agent>,
): boolean {
  let currentParentId = agent.parentAgentId;
  for (let depth = 0; depth < MAX_PARENT_WALK_DEPTH && currentParentId; depth += 1) {
    if (currentParentId === parentAgentId) {
      return true;
    }
    const intermediate = agentsById.get(currentParentId);
    if (!intermediate || intermediate.attend !== "observed") {
      return false;
    }
    currentParentId = intermediate.parentAgentId;
  }
  return false;
}

export function selectSubagentsForParent(
  state: SessionStoreSnapshot,
  params: SelectSubagentsParams,
  pendingArchiveIds: ReadonlySet<string>,
): SubagentRow[] {
  const agents = state.sessions[params.serverId]?.agents;
  if (!agents || agents.size === 0) {
    return EMPTY_SUBAGENT_ROWS;
  }

  const rows: SubagentRow[] = [];
  for (const agent of agents.values()) {
    if (
      agent.archivedAt ||
      pendingArchiveIds.has(agent.id) ||
      !isTrackDescendantOf(agent, params.parentAgentId, agents)
    ) {
      continue;
    }
    rows.push(toSubagentRow(agent));
  }

  if (rows.length === 0) {
    return EMPTY_SUBAGENT_ROWS;
  }

  rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  return rows;
}

export function useSubagentsForParent(params: SelectSubagentsParams): SubagentRow[] {
  const pendingArchiveIds = usePendingArchiveAgentIds(params.serverId);
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectSubagentsForParent(state, params, pendingArchiveIds),
    equal,
  );
}
