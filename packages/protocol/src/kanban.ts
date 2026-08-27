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

/**
 * One command in a remediation route, as argv - never a shell string.
 *
 * The daemon resolves the exact command (including any host flag), so the
 * client only ever displays it, copies it, or runs it on explicit consent.
 */
export const KanbanRemediationStepSchema = z
  .object({
    command: z.string().min(1),
    args: z.array(z.string()),
    /** The literal text shown in the confirm dialog and copied to the clipboard. */
    display: z.string().min(1),
  })
  .strict();

/**
 * A daemon-resolved recovery route for a failed Kanban call.
 *
 * Provider-neutral by construction: `reason` is an opaque key the client may
 * localize and must tolerate not knowing (it falls back to `error`), and the
 * steps are already-resolved argv. This exists because a provider's own error
 * text can be actively misleading in Otto: GitHub tells the user to edit a
 * personal access token, but the credential Otto sends is the gh CLI's OAuth
 * token, which that page does not list. The daemon replaces that guidance
 * rather than passing it through.
 */
export const KanbanRemediationSchema = z
  .object({
    reason: z.string().min(1),
    /** The scopes or permissions the credential lacks, when the provider can name them. */
    missingScopes: z.array(z.string()).optional(),
    steps: z.array(KanbanRemediationStepSchema),
    /** Documentation link for the manual route. */
    url: z.string().url().optional(),
  })
  .strict();

/** The gh CLI credential is missing the Projects v2 scopes. */
export const KANBAN_REMEDIATION_GITHUB_SCOPES = "github-missing-scopes";

export type KanbanRemediationStep = z.infer<typeof KanbanRemediationStepSchema>;
export type KanbanRemediation = z.infer<typeof KanbanRemediationSchema>;

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
      // COMPAT(kanbanRemediation): added in v0.8.12, drop the optional gate when
      // floor >= v0.8.12. Present only when the daemon can name a recovery route
      // for `error`; older daemons omit it and the client shows `error` alone.
      remediation: KanbanRemediationSchema.nullable().optional(),
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
      // COMPAT(kanbanRemediation): added in v0.8.12, drop the optional gate when
      // floor >= v0.8.12. Present only when the daemon can name a recovery route
      // for `error`; older daemons omit it and the client shows `error` alone.
      remediation: KanbanRemediationSchema.nullable().optional(),
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
      // COMPAT(kanbanRemediation): added in v0.8.12, drop the optional gate when
      // floor >= v0.8.12. Present only when the daemon can name a recovery route
      // for `error`; older daemons omit it and the client shows `error` alone.
      remediation: KanbanRemediationSchema.nullable().optional(),
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
      // COMPAT(kanbanRemediation): added in v0.8.12, drop the optional gate when
      // floor >= v0.8.12. Present only when the daemon can name a recovery route
      // for `error`; older daemons omit it and the client shows `error` alone.
      remediation: KanbanRemediationSchema.nullable().optional(),
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
      // COMPAT(kanbanRemediation): added in v0.8.12, drop the optional gate when
      // floor >= v0.8.12. Present only when the daemon can name a recovery route
      // for `error`; older daemons omit it and the client shows `error` alone.
      remediation: KanbanRemediationSchema.nullable().optional(),
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

/**
 * The one "this project has no board yet" message. The app matches on it to
 * render the watermark state with a link into project settings, so it is part
 * of the contract rather than incidental copy. Lives with the wire model (not
 * the daemon) so the app can compare against it without depending on the
 * server package.
 */
export const KANBAN_NOT_CONFIGURED = "No kanban board is configured for this project.";

// Which tracking board a project shows on the Kanban screen. A pointer, never a
// credential: `boardId` is equivalent to a URL, so it rides in the clear and
// lives in the project record next to the display name. Credentials stay
// host-scoped (the gh CLI for GitHub, the Atlassian account for Jira).
// A null `boardId` on the github adapter means "derive the boards from this
// project's git remote"; jira always needs an explicit board id.
export const ProjectKanbanTargetSchema = z
  .object({
    adapter: z.enum(["github", "jira"]),
    boardId: z.string().nullable().optional(),
    // A GitHub board number is unique only within a user or organization. The
    // daemon derives this from a pasted GitHub Projects URL; it stays optional
    // so existing project records (and older peers) keep parsing.
    boardOwner: z.string().nullable().optional(),
  })
  .passthrough();

export type ProjectKanbanTarget = z.infer<typeof ProjectKanbanTargetSchema>;

export const KanbanProjectTargetSetRequestSchema = z.object({
  type: z.literal("kanban.project.target.set.request"),
  projectId: z.string().min(1),
  // Null clears the target and returns the project to "no board configured".
  target: ProjectKanbanTargetSchema.nullable(),
  requestId: z.string(),
});

export const KanbanProjectTargetSetResponsePayloadSchema = z.object({
  requestId: z.string(),
  projectId: z.string(),
  accepted: z.boolean(),
  // The normalized target the daemon actually stored: a pasted board URL comes
  // back as the parsed id, so the settings form can show what was saved.
  target: ProjectKanbanTargetSchema.nullable(),
  error: z.string().nullable(),
});

export const KanbanProjectTargetSetResponseSchema = z.object({
  type: z.literal("kanban.project.target.set.response"),
  payload: KanbanProjectTargetSetResponsePayloadSchema,
});

export type KanbanProjectTargetSetResponse = z.infer<typeof KanbanProjectTargetSetResponseSchema>;

export type KanbanProjectTargetSetRequest = z.infer<typeof KanbanProjectTargetSetRequestSchema>;
