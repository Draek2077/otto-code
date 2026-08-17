import { z } from "zod";

/**
 * Provider-agnostic Kanban wire model.
 *
 * Neither the client nor the daemon controller references a provider's native
 * identifiers (GraphQL node ids, single-select option ids, Jira quick filters)
 * in these shapes. `id`/`status` are opaque strings chosen by the provider;
 * `rawProviderId` carries the provider's native identifier for deep links and
 * later provider-specific features. The first provider is GitHub Projects v2;
 * Jira is next, and it must slot into the same shapes without edits here.
 */

export const KanbanCardSchema = z
  .object({
    /** Agnostic unique id, generated or mapped by the provider. */
    id: z.string().min(1),
    /** Task headline. */
    title: z.string(),
    /** Rich-text or Markdown task description. */
    body: z.string().optional(),
    /** External reference link for deep-linking. */
    url: z.string().url().optional(),
    /** Clear-text column key/name (e.g. "To Do", "In Progress"). */
    status: z.string(),
    /** List of user handles. */
    assignees: z.array(z.string()),
    /** The underlying provider's system identifier. */
    rawProviderId: z.string(),
  })
  .strict();

export const KanbanColumnSchema = z
  .object({
    /** Agnostic unique id for the state (provider option id, Jira quick filter, ...). */
    id: z.string().min(1),
    /** Human-readable title ("To Do", "Done"). */
    name: z.string().min(1),
    /** Ordered list of items sitting within this column. */
    cards: z.array(KanbanCardSchema),
  })
  .strict();

export const KanbanBoardSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    columns: z.array(KanbanColumnSchema),
  })
  .strict();

export const KanbanBoardRefSchema = z
  .object({
    providerId: z.string().min(1),
    boardId: z.string().min(1),
    title: z.string().min(1),
  })
  .strict();

export type KanbanCard = z.infer<typeof KanbanCardSchema>;
export type KanbanColumn = z.infer<typeof KanbanColumnSchema>;
export type KanbanBoard = z.infer<typeof KanbanBoardSchema>;
export type KanbanBoardRef = z.infer<typeof KanbanBoardRefSchema>;

// ── Session RPCs (dotted namespaces, see docs/rpc-namespacing.md) ───────────

export const KanbanErrorSchema = z.string().nullable();

export const KanbanBoardsListRequestSchema = z
  .object({
    type: z.literal("kanban.boards.list.request"),
    /** The provider that owns the board ("memory", "github", ...). */
    providerId: z.string().min(1),
    /**
     * Project scoping. COMPAT(kanbanProjectScoping): added in v0.8.11, drop the
     * optionals after 2027-02-28. The (host, project) pair determines which
     * tracking board the daemon serves: it resolves the project's kanban target
     * (adapter + board identifier) from the project record and fills the
     * provider's list context. serverId is implicit in the connection.
     * Absent on clients that predate project scoping; the daemon answers those
     * with a "no project" error rather than guessing.
     */
    projectId: z.string().min(1).optional(),
    projectKey: z.string().min(1).optional(),
    requestId: z.string(),
  })
  .strict();

export const KanbanBoardsListResponseSchema = z
  .object({
    type: z.literal("kanban.boards.list.response"),
    payload: z.object({
      providerId: z.string().min(1),
      boards: z.array(KanbanBoardRefSchema),
      error: KanbanErrorSchema,
      requestId: z.string(),
    }),
  })
  .strict();

export const KanbanBoardGetRequestSchema = z
  .object({
    type: z.literal("kanban.board.get.request"),
    providerId: z.string().min(1),
    boardId: z.string().min(1),
    requestId: z.string(),
  })
  .strict();

export const KanbanBoardGetResponseSchema = z
  .object({
    type: z.literal("kanban.board.get.response"),
    payload: z.object({
      providerId: z.string().min(1),
      board: KanbanBoardSchema.nullable(),
      error: KanbanErrorSchema,
      requestId: z.string(),
    }),
  })
  .strict();

export const KanbanCardMoveRequestSchema = z
  .object({
    type: z.literal("kanban.card.move.request"),
    providerId: z.string().min(1),
    boardId: z.string().min(1),
    cardId: z.string().min(1),
    targetColumnId: z.string().min(1),
    requestId: z.string(),
  })
  .strict();

export const KanbanCardMoveResponseSchema = z
  .object({
    type: z.literal("kanban.card.move.response"),
    payload: z.object({
      providerId: z.string().min(1),
      boardId: z.string().min(1),
      cardId: z.string().min(1),
      targetColumnId: z.string().min(1),
      error: KanbanErrorSchema,
      requestId: z.string(),
    }),
  })
  .strict();

export const KanbanCardCreateRequestSchema = z
  .object({
    type: z.literal("kanban.card.create.request"),
    providerId: z.string().min(1),
    boardId: z.string().min(1),
    columnId: z.string().min(1).optional(),
    title: z.string().trim().min(1),
    body: z.string().optional(),
    requestId: z.string(),
  })
  .strict();

export const KanbanCardCreateResponseSchema = z
  .object({
    type: z.literal("kanban.card.create.response"),
    payload: z.object({
      providerId: z.string().min(1),
      boardId: z.string().min(1),
      columnId: z.string().min(1),
      card: KanbanCardSchema.nullable(),
      error: KanbanErrorSchema,
      requestId: z.string(),
    }),
  })
  .strict();

export const KanbanTaskLinkRequestSchema = z
  .object({
    type: z.literal("kanban.task.link.request"),
    providerId: z.string().min(1),
    boardId: z.string().min(1),
    /** The provider's native id of the external work object (issue/PR id). */
    externalId: z.string().min(1),
    columnId: z.string().min(1).optional(),
    requestId: z.string(),
  })
  .strict();

export const KanbanTaskLinkResponseSchema = z
  .object({
    type: z.literal("kanban.task.link.response"),
    payload: z.object({
      providerId: z.string().min(1),
      boardId: z.string().min(1),
      columnId: z.string().min(1),
      card: KanbanCardSchema.nullable(),
      error: KanbanErrorSchema,
      requestId: z.string(),
    }),
  })
  .strict();

export type KanbanBoardsListRequest = z.infer<typeof KanbanBoardsListRequestSchema>;
export type KanbanBoardsListResponse = z.infer<typeof KanbanBoardsListResponseSchema>;
export type KanbanBoardGetRequest = z.infer<typeof KanbanBoardGetRequestSchema>;
export type KanbanBoardGetResponse = z.infer<typeof KanbanBoardGetResponseSchema>;
export type KanbanCardMoveRequest = z.infer<typeof KanbanCardMoveRequestSchema>;
export type KanbanCardMoveResponse = z.infer<typeof KanbanCardMoveResponseSchema>;
export type KanbanCardCreateRequest = z.infer<typeof KanbanCardCreateRequestSchema>;
export type KanbanCardCreateResponse = z.infer<typeof KanbanCardCreateResponseSchema>;
export type KanbanTaskLinkRequest = z.infer<typeof KanbanTaskLinkRequestSchema>;
export type KanbanTaskLinkResponse = z.infer<typeof KanbanTaskLinkResponseSchema>;
