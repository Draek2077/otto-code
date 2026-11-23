import type { AgentStorage, StoredAgentRecord } from "../../../agent/agent-storage.js";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../../messages.js";
import type { ProjectRegistry, WorkspaceRegistry } from "../../../workspace-registry.js";
import type { AgentTimelineRow } from "../../../agent/agent-timeline-store-types.js";
import { projectSearchMessages } from "./messages.js";
import type { ChatSearchService } from "./service.js";
import type { SearchChat } from "./types.js";

type SearchRequest = Extract<SessionInboundMessage, { type: `search.chats.${string}.request` }>;

export function isChatSearchRequest(message: SessionInboundMessage): message is SearchRequest {
  return message.type.startsWith("search.chats.");
}

export function isSearchableRecord(record: StoredAgentRecord): boolean {
  return !record.internal && !record.owner;
}

export async function listSearchChats(ports: {
  storage: Pick<AgentStorage, "list">;
  workspaces: Pick<WorkspaceRegistry, "list">;
  projects: Pick<ProjectRegistry, "list">;
}): Promise<SearchChat[]> {
  const [records, workspaces, projects] = await Promise.all([
    ports.storage.list(),
    ports.workspaces.list(),
    ports.projects.list(),
  ]);
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.workspaceId, workspace]));
  const projectsById = new Map(projects.map((project) => [project.projectId, project]));
  return records.filter(isSearchableRecord).map((record) => {
    const workspace = record.workspaceId ? workspaceById.get(record.workspaceId) : undefined;
    const project = workspace ? projectsById.get(workspace.projectId) : undefined;
    return {
      id: record.id,
      title: record.title || "Chat",
      provider: record.provider,
      workspaceId: record.workspaceId ?? null,
      projectId: workspace?.projectId ?? null,
      projectName: project?.customName ?? project?.displayName ?? "",
      archived: Boolean(record.archivedAt),
    };
  });
}

interface SearchHost {
  service: ChatSearchService | undefined;
  visibleProvider(provider: string): boolean;
  open(agentId: string): Promise<{
    rows: AgentTimelineRow[];
    epoch: string;
    workspaceId: string | null;
  } | null>;
  emit(message: SessionOutboundMessage): void;
}

export async function dispatchChatSearch(message: SearchRequest, host: SearchHost): Promise<void> {
  const { requestId } = message;
  try {
    if (!host.service) throw new Error("Chat search is unavailable");
    if (message.type === "search.chats.query.request") {
      const result = await host.service.search(message, host.visibleProvider);
      host.emit({ type: "search.chats.query.response", payload: { requestId, ...result } });
      return;
    }
    const { agentId, messageKey } = message;
    const timeline = await host.open(agentId);
    const match =
      timeline && projectSearchMessages(timeline.rows).find((row) => row.key === messageKey);
    host.emit({
      type: "search.chats.resolve.response",
      payload: {
        requestId,
        agentId,
        workspaceId: timeline?.workspaceId ?? null,
        target: match && timeline ? { epoch: timeline.epoch, seq: match.sourceSeq } : null,
      },
    });
  } catch {
    host.emit({
      type: "rpc_error",
      payload: {
        requestId,
        requestType: message.type,
        code: "chat_search_failed",
        error: "Chat history could not be read on this host.",
      },
    });
  }
}
