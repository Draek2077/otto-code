import type { KanbanBoard, KanbanBoardRef, KanbanCard } from "@otto-code/protocol/kanban";
import type {
  KanbanBoardGetRequest,
  KanbanBoardsListRequest,
  KanbanCardCreateRequest,
  KanbanCardMoveRequest,
  KanbanTaskLinkRequest,
  SessionOutboundMessage,
} from "@otto-code/protocol/messages";
import { createKanbanRegistry, type KanbanRegistry } from "./kanban-registry.js";
import type { MutableDaemonConfig } from "@otto-code/protocol/messages";

/**
 * Session-facing Kanban dispatcher. Owns the provider registry, translates
 * wire requests to SPI calls, and emits correlated responses. Provider
 * failures become a plain `error` string in the response payload - the wire
 * never sees a provider-specific error type.
 */
export interface KanbanSessionHost {
  emit(message: SessionOutboundMessage): void;
  readConfig: () => MutableDaemonConfig;
  log: {
    info: (message: string) => void;
    error: (message: string, error?: unknown) => void;
  };
}

export class KanbanSession {
  private readonly registry: KanbanRegistry;
  private readonly host: KanbanSessionHost;
  private initializedProviders = new Set<string>();

  constructor(host: KanbanSessionHost) {
    this.host = host;
    this.registry = createKanbanRegistry(host.readConfig);
  }

  async handleBoardsListRequest(msg: KanbanBoardsListRequest): Promise<void> {
    const providerId = msg.providerId;
    const emit = (boards: KanbanBoardRef[], error: string | null) => {
      this.host.emit({
        type: "kanban.boards.list.response",
        payload: { providerId, boards, error, requestId: msg.requestId },
      });
    };
    const provider = this.registry.getProvider(providerId);
    if (!provider) {
      emit([], `Unknown kanban provider: ${providerId}`);
      return;
    }
    try {
      await this.ensureInitialized(providerId);
      emit(await provider.listBoards({}), null);
    } catch (error) {
      this.host.log.error("kanban.boards.list failed", error);
      emit([], describeError(error));
    }
  }

  async handleBoardGetRequest(msg: KanbanBoardGetRequest): Promise<void> {
    const emit = (board: KanbanBoard | null, error: string | null) => {
      this.host.emit({
        type: "kanban.board.get.response",
        payload: {
          providerId: msg.providerId,
          board,
          error,
          requestId: msg.requestId,
        },
      });
    };
    const provider = this.registry.getProvider(msg.providerId);
    if (!provider) {
      emit(null, `Unknown kanban provider: ${msg.providerId}`);
      return;
    }
    try {
      await this.ensureInitialized(msg.providerId);
      emit(await provider.getBoard(msg.boardId), null);
    } catch (error) {
      this.host.log.error("kanban.board.get failed", error);
      emit(null, describeError(error));
    }
  }

  async handleCardMoveRequest(msg: KanbanCardMoveRequest): Promise<void> {
    const emit = (error: string | null) => {
      this.host.emit({
        type: "kanban.card.move.response",
        payload: {
          providerId: msg.providerId,
          boardId: msg.boardId,
          cardId: msg.cardId,
          targetColumnId: msg.targetColumnId,
          error,
          requestId: msg.requestId,
        },
      });
    };
    const provider = this.registry.getProvider(msg.providerId);
    if (!provider) {
      emit(`Unknown kanban provider: ${msg.providerId}`);
      return;
    }
    try {
      await this.ensureInitialized(msg.providerId);
      await provider.moveCard(msg.boardId, msg.cardId, msg.targetColumnId);
      emit(null);
    } catch (error) {
      this.host.log.error("kanban.card.move failed", error);
      emit(describeError(error));
    }
  }

  async handleCardCreateRequest(msg: KanbanCardCreateRequest): Promise<void> {
    const emit = (columnId: string, card: KanbanCard | null, error: string | null) => {
      this.host.emit({
        type: "kanban.card.create.response",
        payload: {
          providerId: msg.providerId,
          boardId: msg.boardId,
          columnId,
          card,
          error,
          requestId: msg.requestId,
        },
      });
    };
    const provider = this.registry.getProvider(msg.providerId);
    if (!provider) {
      emit(msg.columnId ?? "default", null, `Unknown kanban provider: ${msg.providerId}`);
      return;
    }
    try {
      await this.ensureInitialized(msg.providerId);
      const card = await provider.createCard(msg.boardId, msg.columnId ?? null, {
        title: msg.title,
        ...(msg.body ? { body: msg.body } : {}),
      });
      emit(msg.columnId ?? "default", card, null);
    } catch (error) {
      this.host.log.error("kanban.card.create failed", error);
      emit(msg.columnId ?? "default", null, describeError(error));
    }
  }

  async handleTaskLinkRequest(msg: KanbanTaskLinkRequest): Promise<void> {
    const emit = (columnId: string, card: KanbanCard | null, error: string | null) => {
      this.host.emit({
        type: "kanban.task.link.response",
        payload: {
          providerId: msg.providerId,
          boardId: msg.boardId,
          columnId,
          card,
          error,
          requestId: msg.requestId,
        },
      });
    };
    const provider = this.registry.getProvider(msg.providerId);
    if (!provider) {
      emit(msg.columnId ?? "default", null, `Unknown kanban provider: ${msg.providerId}`);
      return;
    }
    try {
      await this.ensureInitialized(msg.providerId);
      const card = await provider.linkExternalTask(
        msg.boardId,
        { externalId: msg.externalId },
        msg.columnId ?? null,
      );
      emit(msg.columnId ?? "default", card, null);
    } catch (error) {
      this.host.log.error("kanban.task.link failed", error);
      emit(msg.columnId ?? "default", null, describeError(error));
    }
  }

  private async ensureInitialized(providerId: string): Promise<void> {
    if (this.initializedProviders.has(providerId)) {
      return;
    }
    await this.registry.initialize(providerId);
    this.initializedProviders.add(providerId);
  }

  dispose(): void {
    this.registry.dispose();
    this.initializedProviders.clear();
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
