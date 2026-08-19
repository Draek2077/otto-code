import { z } from "zod";

/**
 * Otto storage wire schemas: the history.agents.* archive and the attachments.images.* RPCs that report and clear daemon-side storage. Fork-only capability, so it owns its schemas; messages.ts re-exports them.
 */

// ── History management ──────────────────────────────────────────────────────
// Bulk counterpart to the existing flat `delete_agent_request`: hard-delete
// every archived chat record at or past a cutoff in one server-side pass. It has
// to be server-side because the history list is cursor-paginated across hosts,
// so the client never holds the whole archived set.
//
// Deleting a chat removes Otto's record only. Provider-owned session data is
// deliberately left in place. See docs/chat-lifecycle.md.
// Gated by server_info.features.historyDelete.
export const HistoryAgentsClearArchivedRequestSchema = z.object({
  type: z.literal("history.agents.clear_archived.request"),
  // 0 = every archived chat. N = only chats archived at least N days ago.
  olderThanDays: z.number().int().min(0).default(0),
  // Safe by default: a request that omits the flag previews instead of deleting.
  // The client always sends it explicitly.
  dryRun: z.boolean().default(true),
  requestId: z.string(),
});

export const HistoryAgentsClearArchivedResponseSchema = z.object({
  type: z.literal("history.agents.clear_archived.response"),
  payload: z.object({
    // How many archived records the cutoff selected - the number the confirm
    // dialog quotes back after a dry run.
    matched: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    // Ids actually deleted, so the client drops exactly those rows from its
    // caches. Empty on a dry run. Unlike close_items_response, a destructive
    // batch reports per-item outcome rather than silently omitting failures.
    agentIds: z.array(z.string()),
    dryRun: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
    ottoBytes: z.number().int().nonnegative().optional(),
    reclaimedBytes: z.number().int().nonnegative().optional(),
  }),
});

export const HistoryAgentsStorageStatsRequestSchema = z.object({
  type: z.literal("history.agents.get_storage_stats.request"),
  requestId: z.string(),
});

export const HistoryAgentsStorageStatsResponseSchema = z.object({
  type: z.literal("history.agents.get_storage_stats.response"),
  payload: z.object({
    archivedCount: z.number().int().nonnegative(),
    totalBytes: z.number().nonnegative(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

// ── Attachment storage ──────────────────────────────────────────────────────
// Agents produce image bytes continuously (browser screenshots above all), and
// the daemon materializes each one to $OTTO_HOME/attachments so the timeline has
// a file to point at. These two RPCs are the user's window into that store: how
// much is there, and give it back. See docs/attachment-lifecycle.md.
//
// Scope is deliberately global, not per-chat or per-workspace. Filenames are a
// content hash, so the same bytes may be referenced from several transcripts and
// "this workspace's images" is a fiction we would have to invent and maintain.
// Gated by server_info.features.attachmentStorage.
export const AttachmentsImagesStatsRequestSchema = z.object({
  type: z.literal("attachments.images.get_stats.request"),
  requestId: z.string(),
});

export const AttachmentsImagesStatsResponseSchema = z.object({
  type: z.literal("attachments.images.get_stats.response"),
  payload: z.object({
    fileCount: z.number().int().nonnegative(),
    totalBytes: z.number().nonnegative(),
    // ISO timestamp of the oldest image, or null when the store is empty. The
    // readout quotes it so "512 MB" comes with "since March".
    oldestAt: z.string().nullable(),
    // The policy currently in force, so the settings row shows real numbers
    // rather than the client's idea of the defaults.
    maxAgeDays: z.number().int().nonnegative(),
    maxTotalMb: z.number().int().nonnegative(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const AttachmentsImagesClearRequestSchema = z.object({
  type: z.literal("attachments.images.clear.request"),
  // 0 = every stored image. N = only images untouched for at least N days.
  olderThanDays: z.number().int().min(0).default(0),
  // Safe by default: a request that omits the flag previews instead of deleting.
  // The client always sends it explicitly. Same contract as
  // history.agents.clear_archived, and for the same reason - the client cannot
  // enumerate the set, and there is no undo.
  dryRun: z.boolean().default(true),
  requestId: z.string(),
});

export const AttachmentsImagesClearResponseSchema = z.object({
  type: z.literal("attachments.images.clear.response"),
  payload: z.object({
    matched: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
    freedBytes: z.number().nonnegative(),
    dryRun: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export type HistoryAgentsClearArchivedRequest = z.infer<
  typeof HistoryAgentsClearArchivedRequestSchema
>;

export type HistoryAgentsClearArchivedResponse = z.infer<
  typeof HistoryAgentsClearArchivedResponseSchema
>;

export type HistoryAgentsStorageStatsRequest = z.infer<
  typeof HistoryAgentsStorageStatsRequestSchema
>;

export type HistoryAgentsStorageStatsResponse = z.infer<
  typeof HistoryAgentsStorageStatsResponseSchema
>;

export type AttachmentsImagesStatsRequest = z.infer<typeof AttachmentsImagesStatsRequestSchema>;

export type AttachmentsImagesStatsResponse = z.infer<typeof AttachmentsImagesStatsResponseSchema>;

export type AttachmentsImagesClearRequest = z.infer<typeof AttachmentsImagesClearRequestSchema>;

export type AttachmentsImagesClearResponse = z.infer<typeof AttachmentsImagesClearResponseSchema>;
