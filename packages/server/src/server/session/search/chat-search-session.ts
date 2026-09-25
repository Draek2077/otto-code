import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { AgentManager } from "../../agent/agent-manager.js";
import type { AgentStorage } from "../../agent/agent-storage.js";
import type { Logger } from "pino";
import { ensureAgentLoaded } from "../../agent/agent-loading.js";
import { projectSearchMessages } from "../../chat-search/messages.js";
interface Context {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  logger: Logger;
  emit(message: SessionOutboundMessage): void;
}

export async function handleChatSearch(
  request: Extract<
    SessionInboundMessage,
    { type: "search.chats.query.request" | "search.chats.resolve.request" }
  >,
  context: Context,
): Promise<void> {
  try {
    const search = context.agentManager.chatSearch;
    if (!search) throw new Error("Chat search is unavailable");
    if (request.type === "search.chats.query.request") {
      const result = await search.search(request);
      context.emit({
        type: "search.chats.query.response",
        payload: { requestId: request.requestId, ...result },
      });
      return;
    }
    const agent = await ensureAgentLoaded(request.agentId, {
      agentManager: context.agentManager,
      agentStorage: context.agentStorage,
      logger: context.logger,
    });
    const messages = projectSearchMessages(
      await context.agentManager.getTimelineRows(request.agentId),
    );
    const message = messages.find((item) => item.key === request.messageKey);
    const epoch = context.agentManager.fetchTimeline(request.agentId, { limit: 1 }).epoch;
    context.emit({
      type: "search.chats.resolve.response",
      payload: {
        requestId: request.requestId,
        agentId: request.agentId,
        workspaceId: agent.workspaceId ?? null,
        target: message ? { epoch, seq: message.sourceSeq } : null,
      },
    });
  } catch (error) {
    context.emit({
      type: "rpc_error",
      payload: {
        requestId: request.requestId,
        requestType: request.type,
        error: error instanceof Error ? error.message : String(error),
        code: "chat_search_failed",
      },
    });
  }
}
