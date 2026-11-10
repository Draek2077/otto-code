import type { Agent, SessionState } from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import {
  MAX_VISUALIZER_AGENTS,
  type VisualizerAgentInput,
  type VisualizerProjectionInput,
} from "./projection";
export interface VisualizerFeedSelection {
  selectedId: string | null;
  follow: boolean;
}
export function visualizerFocusedRoot(
  agents: readonly Agent[],
  agentId: string | null,
): string | null {
  const map = new Map(agents.map((agent) => [agent.id, agent]));
  let current = agentId ? map.get(agentId) : undefined;
  const visited = new Set<string>();
  while (current?.parentAgentId && map.has(current.parentAgentId) && !visited.has(current.id)) {
    visited.add(current.id);
    current = map.get(current.parentAgentId);
  }
  return current?.id ?? null;
}
export function visualizerTimelineDemand(
  agents: readonly Agent[],
  focusedAgentId: string | null,
  selection: VisualizerFeedSelection,
) {
  const roots = new Set(agents.map((agent) => visualizerFocusedRoot(agents, agent.id)));
  if (!selection.follow && selection.selectedId === "otto:all-active-chats")
    return agents.map((agent) => agent.id);
  const selected =
    selection.selectedId && roots.has(selection.selectedId) ? selection.selectedId : null;
  const root = selection.follow
    ? (visualizerFocusedRoot(agents, focusedAgentId) ?? selected ?? roots.values().next().value)
    : (selected ?? roots.values().next().value);
  return agents
    .filter((agent) => visualizerFocusedRoot(agents, agent.id) === root)
    .map((agent) => agent.id);
}

function phase(agent: Agent): VisualizerAgentInput["phase"] {
  if (agent.status === "closed" || agent.archivedAt) return "closed";
  if (agent.pendingPermissions.length) return "waiting";
  if (agent.lastError && agent.turn.phase !== "open") return "error";
  return agent.turn.phase === "open" ? "working" : "idle";
}
export function visualizerWorkspaceAgents(
  session: Pick<SessionState, "agents" | "agentDetails">,
  tabs: readonly WorkspaceTab[],
  workspaceId: string,
) {
  const roots = tabs.flatMap((tab) => (tab.target.kind === "agent" ? [tab.target.agentId] : []));
  const all = new Map([...session.agentDetails, ...session.agents]);
  const selected = new Set(
    roots.filter((id) => {
      const agent = all.get(id);
      return agent?.workspaceId === workspaceId && !agent.archivedAt;
    }),
  );
  // Paseo already owns child discovery. Include its real parent edges; never
  // infer subagents by parsing provider tool arguments or provider log files.
  for (let pass = 0; pass < MAX_VISUALIZER_AGENTS; pass++) {
    let changed = false;
    for (const agent of all.values()) {
      if (
        !agent.parentAgentId ||
        !selected.has(agent.parentAgentId) ||
        selected.has(agent.id) ||
        agent.workspaceId !== workspaceId
      )
        continue;
      selected.add(agent.id);
      changed = true;
      if (selected.size >= MAX_VISUALIZER_AGENTS) break;
    }
    if (!changed || selected.size >= MAX_VISUALIZER_AGENTS) break;
  }
  return [...selected].slice(0, MAX_VISUALIZER_AGENTS).flatMap((id) => {
    const value = all.get(id);
    return value ? [value] : [];
  });
}
export function visualizerCanonicalInput(
  session: Pick<SessionState, "agentStreamTail" | "agentStreamHead"> & {
    viewedTimelineSync: Pick<
      NonNullable<SessionState["viewedTimelineSync"]>,
      "getAgentTimelineStatus"
    > | null;
  },
  agents: readonly Agent[],
  demand?: ReadonlySet<string>,
): VisualizerProjectionInput {
  const timelines = new Map<string, readonly StreamItem[]>();
  const values = agents.map(
    (agent): VisualizerAgentInput => ({
      id: agent.id,
      parentId: agent.parentAgentId,
      title: agent.title,
      provider: agent.provider,
      model: agent.model,
      cwd: agent.cwd,
      phase: phase(agent),
      usage: agent.lastUsage,
      createdAt: agent.createdAt.getTime(),
      updatedAt: agent.lastActivityAt.getTime(),
    }),
  );
  for (const agent of agents) {
    if (demand && !demand.has(agent.id)) continue;
    if (session.viewedTimelineSync?.getAgentTimelineStatus(agent.id) !== "ready") continue;
    timelines.set(agent.id, [
      ...(session.agentStreamTail.get(agent.id) ?? []),
      ...(session.agentStreamHead.get(agent.id) ?? []),
    ]);
  }
  return { agents: values, timelines };
}
