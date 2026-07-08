import type { Agent } from "@/stores/session-store";
import type { WorkspaceTabSnapshot } from "@/stores/workspace-layout-actions";
import { shouldAutoOpenAgentTab } from "@/subagents/policies";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";

export interface WorkspaceAgentVisibility {
  activeAgentIds: Set<string>;
  autoOpenAgentIds: Set<string>;
  knownAgentIds: Set<string>;
}

function agentBelongsToWorkspace(agent: Agent, workspaceId: string): boolean {
  return normalizeWorkspaceOpaqueId(agent.workspaceId) === workspaceId;
}

export function deriveWorkspaceAgentVisibility(input: {
  sessionAgents: Map<string, Agent> | undefined;
  agentDetails?: Map<string, Agent> | undefined;
  workspaceId: string | null | undefined;
}): WorkspaceAgentVisibility {
  const { sessionAgents, agentDetails } = input;
  const workspaceId = normalizeWorkspaceOpaqueId(input.workspaceId);
  if ((!sessionAgents && !agentDetails) || !workspaceId) {
    return {
      activeAgentIds: new Set<string>(),
      autoOpenAgentIds: new Set<string>(),
      knownAgentIds: new Set<string>(),
    };
  }

  const activeAgentIds = new Set<string>();
  const autoOpenAgentIds = new Set<string>();
  const knownAgentIds = new Set<string>();
  for (const agent of sessionAgents?.values() ?? []) {
    if (!agentBelongsToWorkspace(agent, workspaceId)) {
      continue;
    }
    knownAgentIds.add(agent.id);
    if (!agent.archivedAt) {
      activeAgentIds.add(agent.id);
      if (shouldAutoOpenAgentTab(agent)) {
        autoOpenAgentIds.add(agent.id);
      }
    }
  }
  for (const agent of agentDetails?.values() ?? []) {
    if (!agentBelongsToWorkspace(agent, workspaceId)) {
      continue;
    }
    knownAgentIds.add(agent.id);
  }

  return { activeAgentIds, autoOpenAgentIds, knownAgentIds };
}

export function buildWorkspaceTabSnapshot(input: {
  agentVisibility: WorkspaceAgentVisibility;
  agentsHydrated: boolean;
  terminalsHydrated: boolean;
  knownTerminalIds: Iterable<string>;
  standaloneTerminalIds: Iterable<string>;
  hasActivePendingDraftCreate: boolean;
}): WorkspaceTabSnapshot {
  return {
    agentsHydrated: input.agentsHydrated,
    terminalsHydrated: input.terminalsHydrated,
    activeAgentIds: input.agentVisibility.activeAgentIds,
    autoOpenAgentIds: input.agentVisibility.autoOpenAgentIds,
    knownAgentIds: input.agentVisibility.knownAgentIds,
    knownTerminalIds: input.knownTerminalIds,
    standaloneTerminalIds: input.standaloneTerminalIds,
    hasActivePendingDraftCreate: input.hasActivePendingDraftCreate,
  };
}

interface WorkspaceAgentVisibilitySessionSlice {
  agents: Map<string, Agent>;
  agentDetails: Map<string, Agent>;
}

/**
 * Selector factory that memoizes by input identity. Zustand runs selectors on
 * every store write — during agent activity the session store flushes stream
 * items every ~48ms — but the agents/agentDetails maps are only replaced on
 * agent lifecycle changes. Caching by map identity turns the per-write cost
 * from an O(agents) re-derivation into two identity checks per mounted
 * workspace screen.
 */
export function createWorkspaceAgentVisibilitySelector(input: {
  serverId: string;
  workspaceId: string;
}): (state: {
  sessions: Partial<Record<string, WorkspaceAgentVisibilitySessionSlice>>;
}) => WorkspaceAgentVisibility {
  let cache: {
    agents: Map<string, Agent> | undefined;
    agentDetails: Map<string, Agent> | undefined;
    result: WorkspaceAgentVisibility;
  } | null = null;
  return (state) => {
    const session = state.sessions[input.serverId];
    const agents = session?.agents;
    const agentDetails = session?.agentDetails;
    if (cache && cache.agents === agents && cache.agentDetails === agentDetails) {
      return cache.result;
    }
    const result = deriveWorkspaceAgentVisibility({
      sessionAgents: agents,
      agentDetails,
      workspaceId: input.workspaceId,
    });
    cache = { agents, agentDetails, result };
    return result;
  };
}

export function workspaceAgentVisibilityEqual(
  a: WorkspaceAgentVisibility,
  b: WorkspaceAgentVisibility,
): boolean {
  return (
    setsEqual(a.activeAgentIds, b.activeAgentIds) &&
    setsEqual(a.autoOpenAgentIds, b.autoOpenAgentIds) &&
    setsEqual(a.knownAgentIds, b.knownAgentIds)
  );
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const item of a) {
    if (!b.has(item)) {
      return false;
    }
  }
  return true;
}

// Prune agent tabs that are no longer active once agents are hydrated.
// Archived agents get pruned so that archiving on one client closes the tab on all clients.
export function shouldPruneWorkspaceAgentTab(input: {
  agentId: string;
  agentsHydrated: boolean;
  activeAgentIds: Set<string>;
}): boolean {
  if (!input.agentId.trim()) {
    return false;
  }
  if (!input.agentsHydrated) {
    return false;
  }
  return !input.activeAgentIds.has(input.agentId);
}
