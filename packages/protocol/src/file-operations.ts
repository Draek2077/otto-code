import { z } from "zod";

/**
 * Otto file-operation wire schemas: the file.search, file.replace, file.create/delete/rename and file.watch RPCs and pushes used by the file explorer and editor. Fork-only capability, so it owns its schemas; messages.ts re-exports them.
 */

export const FileEolSchema = z.enum(["lf", "crlf"]);

/** What a directory entry is. Shared by the file-mutation RPCs below. */
export const FileEntryKindSchema = z.enum(["file", "directory"]);

/**
 * The general file-mutation surface: create, delete, rename/move.
 *
 * Deliberately separate from `file.write.request`, which is the text editor's
 * conditional *content* save. These three change what exists in the directory
 * rather than what is inside a file, and unlike `file.write` they are
 * **workspace-bounded**: the daemon refuses a `cwd` outside every known Otto
 * workspace, the way directory listing already does. Editing a stray file the
 * user opened by path is one thing; unlinking one is another.
 *
 * `path` is workspace-relative throughout, matching every other file RPC.
 */
export const FileCreateRequestSchema = z.object({
  type: z.literal("file.create.request"),
  cwd: z.string(),
  path: z.string(),
  kind: FileEntryKindSchema,
  requestId: z.string(),
});

/**
 * Permanent delete - an unlink, not a move to the OS trash. The daemon may be
 * headless, remote, or inside WSL, where there is no reliable trash to move to;
 * a "deleted" file that silently stayed on disk in one environment and vanished
 * in another would be worse than either. The client's confirmation says so.
 */
export const FileDeleteRequestSchema = z.object({
  type: z.literal("file.delete.request"),
  cwd: z.string(),
  path: z.string(),
  // Required to delete a directory that has children. Absent (the default) a
  // non-empty directory comes back as `not_empty` and nothing is removed, so a
  // client that never asks can never recursively wipe a tree by accident.
  recursive: z.boolean().optional(),
  requestId: z.string(),
});

/**
 * Rename and move are the same operation - a move is a rename whose new path
 * has a different parent. Never clobbers: an occupied destination comes back as
 * `exists` and nothing moves. There is no overwrite flag on purpose, so this
 * RPC cannot destroy a file the user did not name.
 */
export const FileRenameRequestSchema = z.object({
  type: z.literal("file.rename.request"),
  cwd: z.string(),
  path: z.string(),
  newPath: z.string(),
  requestId: z.string(),
});

// Subscriptions exist only for paths open in tabs; the daemon cleans them up
// when the session ends.
export const FileWatchSubscribeRequestSchema = z.object({
  type: z.literal("file.watch.subscribe.request"),
  cwd: z.string(),
  path: z.string(),
  requestId: z.string(),
});

export const FileWatchUnsubscribeRequestSchema = z.object({
  type: z.literal("file.watch.unsubscribe.request"),
  cwd: z.string(),
  path: z.string(),
  requestId: z.string(),
});

/**
 * Project-wide search ("Find in Files" semantics: explicit search, not
 * per-keystroke). Results stream as file.search.result events correlated by
 * searchId (= this requestId); a new search from the same session supersedes
 * any in-flight one.
 */
export const FileSearchRequestSchema = z.object({
  type: z.literal("file.search.request"),
  cwd: z.string(),
  query: z.string(),
  caseSensitive: z.boolean().optional(),
  wholeWord: z.boolean().optional(),
  regexp: z.boolean().optional(),
  include: z.string().optional(),
  exclude: z.string().optional(),
  requestId: z.string(),
});

export const FileReplaceMatchSchema = z.object({
  /** 1-based line number. */
  line: z.number().int().positive(),
  /** 1-based character column of the match start. */
  column: z.number().int().positive(),
  /** Match length in characters. */
  length: z.number().int().nonnegative(),
});

/**
 * Preview-first project replace. Each file carries the hash the preview was
 * built against - files changed since are skipped and reported, never
 * corrupted. The replacement string is literal (no capture references in v1).
 */
export const FileReplaceRequestSchema = z.object({
  type: z.literal("file.replace.request"),
  cwd: z.string(),
  replacement: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      expectedHash: z.string(),
      matches: z.array(FileReplaceMatchSchema),
    }),
  ),
  requestId: z.string(),
});

/**
 * Create outcome. `exists` is its own status rather than an error string: it is
 * the one failure the client can act on (offer a different name) instead of
 * merely reporting.
 */
export const FileCreateResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    // Echoed back normalized (forward slashes, workspace-relative) so the client
    // selects the entry it will actually see in the next listing.
    path: z.string(),
    kind: FileEntryKindSchema,
    modifiedAt: z.string(),
    size: z.number(),
  }),
  z.object({ status: z.literal("exists") }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);

export const FileCreateResponseSchema = z.object({
  type: z.literal("file.create.response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    result: FileCreateResultSchema,
    requestId: z.string(),
  }),
});

/**
 * Delete outcome. `not_empty` means the target is a directory with children and
 * the request did not set `recursive` - nothing was removed, and the client can
 * re-ask with the stronger confirmation.
 */
export const FileDeleteResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    path: z.string(),
    kind: FileEntryKindSchema,
  }),
  z.object({ status: z.literal("not_found") }),
  z.object({ status: z.literal("not_empty") }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);

export const FileDeleteResponseSchema = z.object({
  type: z.literal("file.delete.response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    result: FileDeleteResultSchema,
    requestId: z.string(),
  }),
});

/** Rename/move outcome. `exists` means the destination was occupied; nothing moved. */
export const FileRenameResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    from: z.string(),
    to: z.string(),
    kind: FileEntryKindSchema,
  }),
  z.object({ status: z.literal("not_found") }),
  z.object({ status: z.literal("exists") }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);

export const FileRenameResponseSchema = z.object({
  type: z.literal("file.rename.response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    newPath: z.string(),
    result: FileRenameResultSchema,
    requestId: z.string(),
  }),
});

export const FileWatchSubscribeResponseSchema = z.object({
  type: z.literal("file.watch.subscribe.response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    ok: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const FileWatchUnsubscribeResponseSchema = z.object({
  type: z.literal("file.watch.unsubscribe.response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    ok: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const FileSearchMatchSchema = z.object({
  /** 1-based line number. */
  line: z.number().int().positive(),
  /** 1-based character column of the match start within the full line. */
  column: z.number().int().positive(),
  /** Match length in characters. */
  length: z.number().int().nonnegative(),
  /** Display line (possibly truncated around the match). */
  lineText: z.string(),
  /** 0-based offset of the match within lineText. */
  previewStart: z.number().int().nonnegative(),
});

// One event per file with matches, streamed while the scan runs.
export const FileSearchResultEventSchema = z.object({
  type: z.literal("file.search.result"),
  payload: z.object({
    cwd: z.string(),
    searchId: z.string(),
    path: z.string(),
    /** File content hash at match time - the replace precondition. */
    hash: z.string(),
    matches: z.array(FileSearchMatchSchema),
  }),
});

export const FileSearchResponseSchema = z.object({
  type: z.literal("file.search.response"),
  payload: z.object({
    cwd: z.string(),
    status: z.enum(["completed", "truncated", "superseded", "error"]),
    error: z.string().nullable(),
    fileCount: z.number(),
    matchCount: z.number(),
    requestId: z.string(),
  }),
});

export const FileReplaceFileResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    path: z.string(),
    replacedCount: z.number(),
    modifiedAt: z.string(),
    hash: z.string(),
  }),
  // The file changed since the preview; nothing was written to it.
  z.object({
    status: z.literal("skipped"),
    path: z.string(),
    reason: z.string(),
  }),
  z.object({
    status: z.literal("error"),
    path: z.string(),
    message: z.string(),
  }),
]);

export const FileReplaceResponseSchema = z.object({
  type: z.literal("file.replace.response"),
  payload: z.object({
    cwd: z.string(),
    results: z.array(FileReplaceFileResultSchema),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

// Pushed to subscribers when a watched file changes under the editor. Carries
// the fresh disk identity (null when the file is gone) so clients can ignore
// echoes of their own saves; content is re-read on demand.
export const FileWatchEventSchema = z.object({
  type: z.literal("file.watch.event"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    change: z.enum(["changed", "deleted", "recreated"]),
    modifiedAt: z.string().nullable(),
    hash: z.string().nullable(),
    size: z.number().nullable(),
  }),
});

export type FileEol = z.infer<typeof FileEolSchema>;

export type FileEntryKind = z.infer<typeof FileEntryKindSchema>;

export type FileCreateRequest = z.infer<typeof FileCreateRequestSchema>;

export type FileCreateResponse = z.infer<typeof FileCreateResponseSchema>;

export type FileCreateResult = z.infer<typeof FileCreateResultSchema>;

export type FileDeleteRequest = z.infer<typeof FileDeleteRequestSchema>;

export type FileDeleteResponse = z.infer<typeof FileDeleteResponseSchema>;

export type FileDeleteResult = z.infer<typeof FileDeleteResultSchema>;

export type FileRenameRequest = z.infer<typeof FileRenameRequestSchema>;

export type FileRenameResponse = z.infer<typeof FileRenameResponseSchema>;

export type FileRenameResult = z.infer<typeof FileRenameResultSchema>;

export type FileWatchSubscribeRequest = z.infer<typeof FileWatchSubscribeRequestSchema>;

export type FileWatchUnsubscribeRequest = z.infer<typeof FileWatchUnsubscribeRequestSchema>;

export type FileWatchEvent = z.infer<typeof FileWatchEventSchema>;

export type FileWatchEventPayload = FileWatchEvent["payload"];

export type FileSearchRequest = z.infer<typeof FileSearchRequestSchema>;

export type FileSearchMatch = z.infer<typeof FileSearchMatchSchema>;

export type FileSearchResultEvent = z.infer<typeof FileSearchResultEventSchema>;

export type FileSearchResultPayload = FileSearchResultEvent["payload"];

export type FileSearchResponse = z.infer<typeof FileSearchResponseSchema>;

export type FileSearchSummary = FileSearchResponse["payload"];

export type FileReplaceRequest = z.infer<typeof FileReplaceRequestSchema>;

export type FileReplaceResponse = z.infer<typeof FileReplaceResponseSchema>;

export type FileReplaceFileResult = z.infer<typeof FileReplaceFileResultSchema>;
