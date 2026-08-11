export interface RunningAgentLabelSource {
  id: string;
  title: string | null;
}

export interface AgentTitleSource {
  title: string | null;
}

/**
 * The daemon's running-agent response is authoritative for which chats are
 * actively writing. Its title is only the launch configuration title, though;
 * an auto-generated chat title lives on the client's hydrated chat snapshot.
 * Resolve the latter first, then retain the daemon value for a client that has
 * not hydrated that chat yet.
 */
export function resolveRunningAgentLabels(
  runningAgents: readonly RunningAgentLabelSource[],
  agentsById: ReadonlyMap<string, AgentTitleSource> | undefined,
  fallbackLabel: string,
): string {
  return runningAgents
    .map((runningAgent) => {
      const hydratedTitle = agentsById?.get(runningAgent.id)?.title;
      return normalizeTitle(hydratedTitle) ?? normalizeTitle(runningAgent.title) ?? fallbackLabel;
    })
    .join(", ");
}

function normalizeTitle(title: string | null | undefined): string | null {
  const normalized = typeof title === "string" ? title.trim() : "";
  return normalized || null;
}
