import type { AgentSnapshotPayload, SessionInboundMessage } from "../../messages.js";

/** Filter before the pager and placement reads. */
export function filterHistoryCandidates(
  agents: readonly AgentSnapshotPayload[],
  request: SessionInboundMessage,
): AgentSnapshotPayload[] {
  if (request.type !== "fetch_agent_history_request" || !request.archiveStatus) return [...agents];
  const archived = request.archiveStatus === "archived";
  return agents.filter((agent) => Boolean(agent.archivedAt) === archived);
}
