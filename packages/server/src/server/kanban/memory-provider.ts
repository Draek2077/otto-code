import type { KanbanBoard, KanbanBoardRef, KanbanCard } from "@otto-code/protocol/kanban";
import type {
  KanbanBoardListContext,
  KanbanProvider,
  MutableKanbanProviderConfig,
} from "./types.js";

/**
 * Stateful local-memory KanbanProvider (plan Step 2: mock infrastructure).
 *
 * It verifies the daemon RPC serialization flow end to end without any
 * network: the same wire round-trip a real provider would make. It seeds one
 * board with the classic To Do / In Progress / Done shape so a connected
 * client can render, drag, and mutate immediately.
 */
export interface InMemoryKanbanProviderOptions {
  providerId?: string;
}

export class InMemoryKanbanProvider implements KanbanProvider {
  readonly providerId: string;

  private readonly boards: Map<string, KanbanBoard>;
  private cardSeq = 0;
  private initialized = false;

  constructor(options: InMemoryKanbanProviderOptions = {}) {
    this.providerId = options.providerId ?? "memory";
    this.boards = new Map();
  }

  async initialize(_config: MutableKanbanProviderConfig): Promise<void> {
    if (!this.initialized) {
      this.seedDefaultBoard();
      this.initialized = true;
    }
  }

  private seedDefaultBoard(): void {
    const boardId = `mem-board-${this.providerId}`;
    const todoId = "todo";
    const inProgressId = "in-progress";
    const doneId = "done";
    const card = (
      title: string,
      columnId: string,
      extra: Partial<KanbanCard> = {},
    ): KanbanCard => ({
      id: `mem-card-${++this.cardSeq}`,
      title,
      status: columnId,
      assignees: [],
      rawProviderId: `mem:${this.cardSeq}`,
      ...extra,
    });
    this.boards.set(boardId, {
      id: boardId,
      title: "Local Demo Board",
      columns: [
        {
          id: todoId,
          name: "To Do",
          cards: [
            card("Prove the RPC round-trip", todoId),
            card("Wire the Jira provider next", todoId),
          ],
        },
        {
          id: inProgressId,
          name: "In Progress",
          cards: [
            card("Ship the board UI", inProgressId, {
              body: "Drag this card; the move goes through the full wire.",
            }),
          ],
        },
        { id: doneId, name: "Done", cards: [card("Design the SPI", doneId)] },
      ],
    });
  }

  private requireBoard(boardId: string): KanbanBoard {
    const board = this.boards.get(boardId);
    if (!board) {
      throw new Error(`Unknown board: ${boardId}`);
    }
    return board;
  }

  private findColumn(board: KanbanBoard, columnId: string) {
    const column = board.columns.find((c) => c.id === columnId);
    if (!column) {
      throw new Error(`Unknown column: ${columnId}`);
    }
    return column;
  }

  private findCard(board: KanbanBoard, cardId: string): KanbanCard {
    const card = board.columns.flatMap((c) => c.cards).find((c) => c.id === cardId);
    if (!card) {
      throw new Error(`Unknown card: ${cardId}`);
    }
    return card;
  }

  async listBoards(_context: KanbanBoardListContext): Promise<KanbanBoardRef[]> {
    return [...this.boards.values()].map((board) => ({
      providerId: this.providerId,
      boardId: board.id,
      title: board.title,
    }));
  }

  async getBoard(boardId: string): Promise<KanbanBoard> {
    // Deep copy: the provider must not hand the session its live state.
    return structuredClone(this.requireBoard(boardId));
  }

  async moveCard(boardId: string, cardId: string, targetColumnId: string): Promise<void> {
    const board = this.requireBoard(boardId);
    const target = this.findColumn(board, targetColumnId);
    const moving = this.findCard(board, cardId);
    const source = board.columns.find((col) => col.cards.some((card) => card.id === cardId));
    if (source) {
      source.cards = source.cards.filter((c) => c.id !== cardId);
    }
    // status carries the clear-text column name (agnostic model); the column
    // membership is the column's cards array.
    moving.status = target.name;
    target.cards.push(moving);
  }

  async createCard(
    boardId: string,
    columnId: string | null,
    taskData: { title: string; body?: string },
  ): Promise<KanbanCard> {
    const board = this.requireBoard(boardId);
    const column = columnId ? this.findColumn(board, columnId) : board.columns[0];
    const card: KanbanCard = {
      id: `mem-card-${++this.cardSeq}`,
      title: taskData.title,
      ...(taskData.body ? { body: taskData.body } : {}),
      status: column.id,
      assignees: [],
      rawProviderId: `mem:${this.cardSeq}`,
    };
    column.cards.push(card);
    return structuredClone(card);
  }

  async linkExternalTask(
    boardId: string,
    external: { owner?: string; repo?: string; externalId: string },
    columnId: string | null,
  ): Promise<KanbanCard> {
    const board = this.requireBoard(boardId);
    if (
      board.columns.flatMap((c) => c.cards).some((c) => c.rawProviderId === external.externalId)
    ) {
      throw new Error(`Task already linked: ${external.externalId}`);
    }
    const column = columnId ? this.findColumn(board, columnId) : board.columns[0];
    const card: KanbanCard = {
      id: `mem-card-${++this.cardSeq}`,
      title: `Linked ${external.externalId}`,
      status: column.id,
      assignees: [],
      rawProviderId: external.externalId,
      url:
        external.owner && external.repo
          ? `https://github.com/${external.owner}/${external.repo}/issues/${external.externalId}`
          : undefined,
    };
    column.cards.push(card);
    return structuredClone(card);
  }
}
