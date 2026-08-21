import { useEffect, useMemo } from "react";
import { usePendingArchiveAgentIds } from "@/hooks/use-archive-agent";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { refreshProviderSubagents, useProviderSubagentStore } from "./provider-store";
import type { ProviderSubagentDescriptorPayload } from "@otto-code/protocol/messages";

export interface OttoSubagentRow {
  kind: "otto";
  id: Agent["id"];
  provider: Agent["provider"];
  title: Agent["title"];
  /** Managed agents have a real title, so the union's task line is always absent for them. */
  description: null;
  subtitle: null;
  status: Agent["status"];
  requiresAttention: Agent["requiresAttention"];
  createdAt: Agent["createdAt"];
  updatedAt: Agent["updatedAt"];
  attend?: Agent["attend"];
  backgrounded?: Agent["backgrounded"];
  cumulativeTokens?: Agent["cumulativeTokens"];
  cumulativeUsage?: Agent["cumulativeUsage"];
  toolUseCount?: Agent["toolUseCount"];
  currentTool?: Agent["currentTool"];
  personalityName?: Agent["personalityName"];
  personalitySpinner?: Agent["personalitySpinner"];
}

export interface ProviderSubagentRow {
  kind: "provider";
  id: string;
  parentAgentId: string;
  provider: ProviderSubagentDescriptorPayload["provider"];
  // `title` is the subagent type ("Explore", "general-purpose") and repeats across a fan-out;
  // `description` is the task it was given. Both are carried so presentation can choose which
  // one names the row — collapsing them here is what makes every row read alike.
  title: string | null;
  description: string | null;
  /** Compact provider-owned context. The app displays it without interpreting its contents. */
  subtitle: string | null;
  status: ProviderSubagentDescriptorPayload["status"];
  requiresAttention: boolean;
  createdAt: Date;
}

export type SubagentRow = OttoSubagentRow | ProviderSubagentRow;

type SessionStoreSnapshot = ReturnType<typeof useSessionStore.getState>;
type ProviderSubagentStoreSnapshot = ReturnType<typeof useProviderSubagentStore.getState>;

interface SelectSubagentsParams {
  serverId: string;
  parentAgentId: string;
}

const EMPTY_SUBAGENT_ROWS: SubagentRow[] = [];
const EMPTY_PROVIDER_SUBAGENT_ROWS: ProviderSubagentRow[] = [];

function toSubagentRow(agent: Agent): SubagentRow {
  return {
    kind: "otto",
    id: agent.id,
    provider: agent.provider,
    title: agent.title,
    description: null,
    subtitle: null,
    status: agent.status,
    requiresAttention: agent.requiresAttention,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    attend: agent.attend,
    backgrounded: agent.backgrounded,
    cumulativeTokens: agent.cumulativeTokens,
    cumulativeUsage: agent.cumulativeUsage,
    toolUseCount: agent.toolUseCount,
    currentTool: agent.currentTool,
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
 * chain on purpose - an attended child is its own chat with its own track,
 * and its children are not this chat's rows.
 */
export function isTrackDescendantOf(
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

/**
 * True when at least one OBSERVED sub-agent in `parentAgentId`'s track is still
 * running - i.e. the parent's own turn may be over, but the fan-out it spawned
 * is not. Attended children are excluded on purpose: they are their own chats
 * the user drives, not work this chat is waiting on. Used by the Visualizer's
 * "waiting" voice cue (see docs/visualizer.md "Voice cues").
 */
export function hasRunningObservedSubagent(
  agents: ReadonlyMap<string, Agent>,
  parentAgentId: string,
): boolean {
  for (const agent of agents.values()) {
    if (
      agent.status === "running" &&
      agent.attend === "observed" &&
      !agent.archivedAt &&
      isTrackDescendantOf(agent, parentAgentId, agents)
    ) {
      return true;
    }
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

export function selectProviderSubagentsForParent(
  state: ProviderSubagentStoreSnapshot,
  params: SelectSubagentsParams,
  supported: boolean,
): ProviderSubagentRow[] {
  if (!supported) return EMPTY_PROVIDER_SUBAGENT_ROWS;
  const rows: ProviderSubagentRow[] = [];
  const prefix = `${params.serverId}\0${params.parentAgentId}\0`;
  for (const [key, subagent] of state.descriptors) {
    if (!key.startsWith(prefix) || state.hiddenFromTrack.has(key)) continue;
    rows.push({
      kind: "provider",
      id: subagent.id,
      parentAgentId: subagent.parentAgentId,
      provider: subagent.provider,
      title: subagent.title,
      description: subagent.description,
      subtitle: subagent.subtitle ?? null,
      status: subagent.status,
      requiresAttention: subagent.status === "failed",
      createdAt: new Date(subagent.createdAt),
    });
  }
  rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  return rows;
}

export function useSubagentsForParent(params: SelectSubagentsParams): SubagentRow[] {
  const pendingArchiveIds = usePendingArchiveAgentIds(params.serverId);
  const ottoRows = useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectSubagentsForParent(state, params, pendingArchiveIds),
    equal,
  );
  const supported = useSessionStore(
    (state) => state.sessions[params.serverId]?.serverInfo?.features?.providerSubagents === true,
  );
  const providerRows = useStoreWithEqualityFn(
    useProviderSubagentStore,
    (state) => selectProviderSubagentsForParent(state, params, supported),
    equal,
  );
  const client = useSessionStore((state) => state.sessions[params.serverId]?.client ?? null);

  useEffect(() => {
    if (!client || !supported) return;
    void refreshProviderSubagents(client, params.serverId, params.parentAgentId).catch(
      () => undefined,
    );
  }, [client, params.parentAgentId, params.serverId, supported]);

  return useMemo(() => {
    if (providerRows.length === 0) return ottoRows;
    const rows = [...ottoRows, ...providerRows];
    rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    return rows;
  }, [ottoRows, providerRows]);
}
