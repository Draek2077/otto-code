import type {
  KanbanBoardsListRequest,
  KanbanBoardGetRequest,
  KanbanCardMoveRequest,
  KanbanCardCreateRequest,
  KanbanTaskLinkRequest,
  KanbanCardUpdateRequest,
  KanbanCardDeleteRequest,
  KanbanBoardWatchRequest,
} from "@otto-code/protocol/kanban";

export type KanbanListBoardsInput = Omit<KanbanBoardsListRequest, "type" | "requestId">;
export type KanbanMoveCardInput = Omit<KanbanCardMoveRequest, "type" | "requestId">;
export type KanbanCreateCardInput = Omit<KanbanCardCreateRequest, "type" | "requestId">;
export type KanbanLinkTaskInput = Omit<KanbanTaskLinkRequest, "type" | "requestId">;
export type KanbanUpdateCardInput = Omit<KanbanCardUpdateRequest, "type" | "requestId">;
export type KanbanDeleteCardInput = Omit<KanbanCardDeleteRequest, "type" | "requestId">;
export type KanbanWatchBoardInput = Omit<KanbanBoardWatchRequest, "type" | "requestId">;

type KanbanRequestType =
  | KanbanBoardsListRequest["type"]
  | KanbanBoardGetRequest["type"]
  | KanbanCardMoveRequest["type"]
  | KanbanCardCreateRequest["type"]
  | KanbanTaskLinkRequest["type"]
  | KanbanCardUpdateRequest["type"]
  | KanbanCardDeleteRequest["type"]
  | KanbanBoardWatchRequest["type"];

/** The correlated sender replaces the placeholder request id before sending. */
export function kanbanRequest<T extends KanbanRequestType>(
  type: T,
  input: Record<string, unknown>,
  requestId?: string,
) {
  return { requestId, message: { ...input, type, requestId: "" }, timeout: 60000 };
}
