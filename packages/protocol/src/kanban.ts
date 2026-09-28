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

// ── Card fields ─────────────────────────────────────────────────────────────

/**
 * The kinds of card field Otto can read and write across providers.
 *
 * Deliberately *not* a list of product fields. On GitHub Projects, "priority"
 * and "due date" are ordinary user-created single-select and date fields, not
 * built-ins - hardcoding them would invent a parity neither provider has, and
 * would still miss the fields a team actually configured. Instead a board
 * declares its own fields and each one names the editor it needs. GitHub's
 * writable custom types (`ProjectV2CustomFieldType`: TEXT, SINGLE_SELECT,
 * MULTI_SELECT, NUMBER, DATE, ITERATION) and Jira's editable issue fields both
 * project onto this set.
 *
 * APPEND-ONLY, and the wire carries it as a plain string rather than a closed
 * enum (see normalizeKanbanFieldKind): one field of a kind an older client does
 * not know must not fail the whole board read.
 */
export const KANBAN_FIELD_KINDS = [
  /** Single-line free text. Card titles are this. */
  "text",
  /** Multi-line prose. Card descriptions are this. */
  "richText",
  "number",
  /** Calendar date, ISO `YYYY-MM-DD` on the wire. */
  "date",
  "singleSelect",
  "multiSelect",
  /** People, chosen from the provider's assignable set. */
  "users",
  "labels",
] as const;

export type KanbanFieldKind = (typeof KANBAN_FIELD_KINDS)[number];

const KANBAN_FIELD_KIND_SET: ReadonlySet<string> = new Set<string>(KANBAN_FIELD_KINDS);

/**
 * Post-validation narrowing for a wire-carried field kind. Returns null for a
 * kind this build does not know, which every caller reads as "render the
 * provider's display text, offer no editor" - a newer daemon's field degrades
 * to read-only instead of failing the message.
 */
export function normalizeKanbanFieldKind(value: unknown): KanbanFieldKind | null {
  return typeof value === "string" && KANBAN_FIELD_KIND_SET.has(value)
    ? (value as KanbanFieldKind)
    : null;
}

/** One choice for a select, user, or label field. */
export const KanbanFieldOptionSchema = z
  .object({
    /** Opaque provider id, the value a write sends back. */
    id: z.string().min(1),
    name: z.string().min(1),
    /** Provider-supplied colour, when it has one (label and select swatches). */
    color: z.string().optional(),
  })
  .strict();

/**
 * One field a board exposes on its cards.
 *
 * `editable` is the whole point of this shape: a provider reports what it can
 * really write for this board, so the UI never offers an editor that the
 * provider would reject. A field Otto can read but not write appears with
 * `editable: false` and, where the provider can say why, a `readOnlyReason`.
 */
export const KanbanFieldSchema = z
  .object({
    /** Opaque provider id for the field. */
    id: z.string().min(1),
    name: z.string().min(1),
    /** One of KANBAN_FIELD_KINDS; narrow with normalizeKanbanFieldKind. */
    kind: z.string().min(1),
    editable: z.boolean(),
    /** Plain-language reason the field is read-only, when the provider knows it. */
    readOnlyReason: z.string().optional(),
    /** Choices for singleSelect, multiSelect, users and labels. */
    options: z.array(KanbanFieldOptionSchema).optional(),
    /** This field accepts entered option text when the provider has no fixed catalog. */
    allowCustomOptions: z.boolean().optional(),
  })
  .strict();

/**
 * A new value for one field.
 *
 * Discriminated so a write is unambiguous: "set this text" and "empty this
 * field" are different intents, and a provider that cannot express the second
 * as the first (GitHub needs `clearProjectV2ItemFieldValue`, not a null option
 * id) must be able to tell them apart.
 */
export const KanbanFieldValueInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }).strict(),
  z.object({ kind: z.literal("number"), number: z.number() }).strict(),
  /** ISO `YYYY-MM-DD`. */
  z.object({ kind: z.literal("date"), date: z.string().min(1) }).strict(),
  /** Select options, users, labels: one id for single-valued fields. */
  z.object({ kind: z.literal("options"), optionIds: z.array(z.string().min(1)) }).strict(),
  /** Empty the field. */
  z.object({ kind: z.literal("clear") }).strict(),
]);

/**
 * One card's value for one field.
 *
 * `editable` and `options` may override the board-level field for this card
 * alone, and are absent whenever they agree with it. Both exist because some
 * provider fields are only meaningful per card: a GitHub label id belongs to one
 * repository, so the labels a card can take are its own repository's, and a
 * draft issue cannot take labels at all even though its board-mates can.
 */
export const KanbanCardFieldValueSchema = z
  .object({
    fieldId: z.string().min(1),
    /**
     * What the provider already renders for this value. Always present, so a
     * client can show a field whose kind it does not know how to edit.
     */
    display: z.string(),
    /** The structured value, absent when the field is empty. */
    value: KanbanFieldValueInputSchema.optional(),
    /** Overrides the board field's `editable` for this card only. */
    editable: z.boolean().optional(),
    readOnlyReason: z.string().optional(),
    /** Overrides the board field's `options` for this card only. */
    options: z.array(KanbanFieldOptionSchema).optional(),
  })
  .strict();

export type KanbanFieldOption = z.infer<typeof KanbanFieldOptionSchema>;
export type KanbanField = z.infer<typeof KanbanFieldSchema>;
export type KanbanFieldValueInput = z.infer<typeof KanbanFieldValueInputSchema>;
export type KanbanCardFieldValue = z.infer<typeof KanbanCardFieldValueSchema>;

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
    // COMPAT(kanbanConnectionScope): added in v0.9.27, remove after 2027-03-27.
    projectId: z.string().min(1).optional(),
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
      /**
       * The board's editable field schema, and each card's values keyed by card
       * id.
       *
       * These ride *beside* the board rather than inside it on purpose:
       * KanbanCardSchema and KanbanBoardSchema are `.strict()`, so a client
       * built before this release rejects any card carrying an unknown key and
       * fails the whole board read. A sidecar on the (non-strict) payload keeps
       * an old client reading boards exactly as it did.
       * COMPAT(kanbanCardFields): added in v0.9.25, fold into KanbanCardSchema
       * when the floor >= v0.9.25.
       */
      fields: z.array(KanbanFieldSchema).optional(),
      cardFields: z.record(z.string(), z.array(KanbanCardFieldValueSchema)).optional(),
      /** Board-specific action support; older daemons omit it. */
      canDeleteCards: z.boolean().optional(),
      requestId: z.string(),
    }),
  })
  .strict();

export const KanbanCardMoveRequestSchema = z
  .object({
    type: z.literal("kanban.card.move.request"),
    providerId: z.string().min(1),
    boardId: z.string().min(1),
    projectId: z.string().min(1).optional(),
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
    projectId: z.string().min(1).optional(),
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
    /**
     * Project scope, so the daemon can resolve a bare issue number against the
     * project's own repository. A number alone is ambiguous - every repository
     * has an issue #7 - and the client must not name the repository itself, so
     * the daemon derives it from the project the same way it derives the board.
     * COMPAT(kanbanLinkProjectScoping): added in v0.9.25, drop the optionals
     * when the floor >= v0.9.25.
     */
    projectId: z.string().min(1).optional(),
    projectKey: z.string().min(1).optional(),
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

/**
 * Write one field on one card.
 *
 * One field per request, not a whole card: each provider write is its own API
 * call with its own failure, and a partial batch would leave the caller unable
 * to say which half landed. The client reports the error at the field it came
 * from, then re-reads the board.
 */
export const KanbanCardUpdateRequestSchema = z
  .object({
    type: z.literal("kanban.card.update.request"),
    providerId: z.string().min(1),
    boardId: z.string().min(1),
    projectId: z.string().min(1).optional(),
    cardId: z.string().min(1),
    fieldId: z.string().min(1),
    value: KanbanFieldValueInputSchema,
    requestId: z.string(),
  })
  .strict();

export const KanbanCardUpdateResponseSchema = z
  .object({
    type: z.literal("kanban.card.update.response"),
    payload: z.object({
      providerId: z.string().min(1),
      boardId: z.string().min(1),
      cardId: z.string().min(1),
      fieldId: z.string().min(1),
      /** The card as the provider reports it after the write. */
      card: KanbanCardSchema.nullable(),
      /** The card's field values after the write, so the UI reconciles at once. */
      cardFields: z.array(KanbanCardFieldValueSchema).optional(),
      error: KanbanErrorSchema,
      remediation: KanbanRemediationSchema.nullable().optional(),
      requestId: z.string(),
    }),
  })
  .strict();

/**
 * Remove a card from its board.
 *
 * Board-scoped, never repository-scoped: on GitHub this deletes the project
 * item, which removes a linked issue from the board while leaving the issue
 * itself alone, and deletes a draft issue outright because the draft only ever
 * existed inside the project.
 */
export const KanbanCardDeleteRequestSchema = z
  .object({
    type: z.literal("kanban.card.delete.request"),
    providerId: z.string().min(1),
    boardId: z.string().min(1),
    projectId: z.string().min(1).optional(),
    cardId: z.string().min(1),
    requestId: z.string(),
  })
  .strict();

export const KanbanCardDeleteResponseSchema = z
  .object({
    type: z.literal("kanban.card.delete.response"),
    payload: z.object({
      providerId: z.string().min(1),
      boardId: z.string().min(1),
      cardId: z.string().min(1),
      error: KanbanErrorSchema,
      remediation: KanbanRemediationSchema.nullable().optional(),
      requestId: z.string(),
    }),
  })
  .strict();

/**
 * Start or stop watching a board for changes made outside Otto.
 *
 * The daemon polls the provider - neither GitHub Projects nor Jira can push to
 * a local daemon without a public endpoint, and Otto does not open one - so this
 * is explicitly a freshness subscription and not a live event stream. The daemon
 * emits `kanban.board.changed` when the board's revision moves; the client
 * re-reads rather than patching, so a missed notification costs latency and
 * never correctness.
 */
export const KanbanBoardWatchRequestSchema = z
  .object({
    type: z.literal("kanban.board.watch.request"),
    providerId: z.string().min(1),
    boardId: z.string().min(1),
    projectId: z.string().min(1).optional(),
    /** False to stop watching. */
    watch: z.boolean(),
    requestId: z.string(),
  })
  .strict();

export const KanbanBoardWatchResponseSchema = z
  .object({
    type: z.literal("kanban.board.watch.response"),
    payload: z.object({
      providerId: z.string().min(1),
      boardId: z.string().min(1),
      watching: z.boolean(),
      /** How often the daemon polls this board, so the UI can say so honestly. */
      pollIntervalMs: z.number().optional(),
      error: KanbanErrorSchema,
      requestId: z.string(),
    }),
  })
  .strict();

export const KanbanBoardChangedEventSchema = z
  .object({
    type: z.literal("kanban.board.changed"),
    payload: z.object({
      providerId: z.string().min(1),
      boardId: z.string().min(1),
      /** The provider's change marker that moved. Opaque; for logging only. */
      revision: z.string().optional(),
    }),
  })
  .strict();

export type KanbanCardUpdateRequest = z.infer<typeof KanbanCardUpdateRequestSchema>;
export type KanbanCardUpdateResponse = z.infer<typeof KanbanCardUpdateResponseSchema>;
export type KanbanCardDeleteRequest = z.infer<typeof KanbanCardDeleteRequestSchema>;
export type KanbanCardDeleteResponse = z.infer<typeof KanbanCardDeleteResponseSchema>;
export type KanbanBoardWatchRequest = z.infer<typeof KanbanBoardWatchRequestSchema>;
export type KanbanBoardWatchResponse = z.infer<typeof KanbanBoardWatchResponseSchema>;
export type KanbanBoardChangedEvent = z.infer<typeof KanbanBoardChangedEventSchema>;

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
