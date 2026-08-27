import { describe, expect, it } from "vitest";
import {
  KanbanBoardGetRequestSchema,
  KanbanBoardGetResponseSchema,
  KanbanBoardSchema,
  KanbanBoardsListRequestSchema,
  KanbanBoardsListResponseSchema,
  KanbanCardCreateRequestSchema,
  KanbanCardMoveRequestSchema,
  KanbanTaskLinkRequestSchema,
  ProjectKanbanTargetSchema,
} from "./kanban.js";

describe("kanban wire model", () => {
  it("parses a valid board with opaque column ids", () => {
    const parsed = KanbanBoardSchema.parse({
      id: "board-1",
      title: "Demo",
      columns: [
        {
          id: "col-todo",
          name: "To Do",
          cards: [
            {
              id: "card-1",
              title: "A card",
              status: "To Do",
              assignees: ["alice"],
              rawProviderId: "raw-1",
            },
          ],
        },
      ],
    });
    expect(parsed.id).toBe("board-1");
    expect(parsed.columns[0].cards[0].status).toBe("To Do");
  });

  it("rejects a card missing its opaque rawProviderId", () => {
    const result = KanbanBoardSchema.safeParse({
      id: "board-1",
      title: "Demo",
      columns: [
        {
          id: "col-1",
          name: "To Do",
          cards: [{ id: "card-1", title: "x", status: "To Do", assignees: [] }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("kanban request schemas", () => {
  it("requires a non-empty providerId on every request", () => {
    const withProvider = KanbanBoardsListRequestSchema.safeParse({
      type: "kanban.boards.list.request",
      providerId: "memory",
      requestId: "r1",
    });
    const emptyProvider = KanbanBoardsListRequestSchema.safeParse({
      type: "kanban.boards.list.request",
      providerId: "",
      requestId: "r1",
    });
    expect(withProvider.success).toBe(true);
    expect(emptyProvider.success).toBe(false);
  });

  it("parses a boards list request scoped to a project (new wire)", () => {
    const parsed = KanbanBoardsListRequestSchema.parse({
      type: "kanban.boards.list.request",
      providerId: "github",
      projectId: "project-1",
      projectKey: "key-1",
      requestId: "r1",
    });
    expect(parsed.projectId).toBe("project-1");
    expect(parsed.projectKey).toBe("key-1");
  });

  it("still parses a boards list request without project scoping (old client)", () => {
    const parsed = KanbanBoardsListRequestSchema.parse({
      type: "kanban.boards.list.request",
      providerId: "github",
      requestId: "r1",
    });
    expect(parsed.projectId).toBeUndefined();
    expect(parsed.projectKey).toBeUndefined();
  });

  it("rejects a boards list request with an unknown field (strict)", () => {
    const result = KanbanBoardsListRequestSchema.safeParse({
      type: "kanban.boards.list.request",
      providerId: "github",
      projectId: "project-1",
      serverId: "host-1",
      requestId: "r1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a move request missing its target column", () => {
    const result = KanbanCardMoveRequestSchema.safeParse({
      type: "kanban.card.move.request",
      providerId: "memory",
      boardId: "b",
      cardId: "c",
      requestId: "r1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a create request with a blank title", () => {
    const result = KanbanCardCreateRequestSchema.safeParse({
      type: "kanban.card.create.request",
      providerId: "memory",
      boardId: "b",
      columnId: "col",
      title: "   ",
      requestId: "r1",
    });
    expect(result.success).toBe(false);
  });
});

describe("kanban response schemas", () => {
  it("round-trips a board get response with a null board and error", () => {
    const parsed = KanbanBoardGetResponseSchema.parse({
      type: "kanban.board.get.response",
      payload: {
        providerId: "github",
        board: null,
        error: "Board not found: 42",
        requestId: "r1",
      },
    });
    expect(parsed.payload.board).toBeNull();
    expect(parsed.payload.error).toBe("Board not found: 42");
  });

  it("round-trips a boards list response", () => {
    const parsed = KanbanBoardsListResponseSchema.parse({
      type: "kanban.boards.list.response",
      payload: {
        providerId: "memory",
        boards: [{ providerId: "memory", boardId: "b1", title: "Demo" }],
        error: null,
        requestId: "r1",
      },
    });
    expect(parsed.payload.boards).toHaveLength(1);
  });

  it("round-trips a task link request", () => {
    const parsed = KanbanTaskLinkRequestSchema.parse({
      type: "kanban.task.link.request",
      providerId: "github",
      boardId: "b1",
      externalId: "123",
      requestId: "r1",
    });
    expect(parsed.externalId).toBe("123");
  });

  it("parses a board get request", () => {
    const parsed = KanbanBoardGetRequestSchema.parse({
      type: "kanban.board.get.request",
      providerId: "memory",
      boardId: "b1",
      requestId: "r1",
    });
    expect(parsed.boardId).toBe("b1");
  });
});

describe("project Kanban target schema", () => {
  it("keeps the GitHub board owner additive for existing project records", () => {
    expect(ProjectKanbanTargetSchema.parse({ adapter: "github", boardId: "12" })).toEqual({
      adapter: "github",
      boardId: "12",
    });
    expect(
      ProjectKanbanTargetSchema.parse({
        adapter: "github",
        boardId: "12",
        boardOwner: "acme",
      }),
    ).toEqual({ adapter: "github", boardId: "12", boardOwner: "acme" });
  });
});
