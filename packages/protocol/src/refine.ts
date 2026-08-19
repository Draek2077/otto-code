import { z } from "zod";

/**
 * Otto Refine wire schemas: the file.refine.* RPCs (see docs/refine.md). Fork-only capability, so it owns its schemas; messages.ts re-exports them.
 */

/**
 * Refine - an AI rewrite the user reviews as a diff before anything is written.
 * This RPC only *proposes*: it reads nothing from disk and writes nothing. The
 * accepted result goes back through `file.write.request` like any other save,
 * so the conditional-write precondition still guards it.
 *
 * `base` travels from the client rather than being re-read on the daemon, so
 * the model rewrites exactly the document the user is looking at and the diff
 * they review is the diff of what they saw.
 */
/**
 * One document in a refine request. `id` is opaque and client-minted; the model
 * never sees it and the daemon only echoes it back. That is deliberate: the
 * client maps id -> absolute path itself, so a model that mangles or invents a
 * filename cannot misroute a write. `label` is the only path-ish thing the
 * model sees, and it exists purely so the prompt can say which file is which.
 */
export const FileRefineDocumentSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  content: z.string(),
});

/** A file the model may read for context but must never rewrite. */
export const FileRefineReferenceSchema = z.object({
  label: z.string(),
  content: z.string(),
});

export const FileRefineRequestSchema = z.object({
  type: z.literal("file.refine.request"),
  // Provider resolution only - which workspace's mini-task chain runs this.
  // Documents are NOT read from disk here; they travel on the wire.
  cwd: z.string(),
  // What the model may rewrite. The blast radius of the whole request: a file
  // absent from this list cannot be changed, whatever the model returns.
  documents: z.array(FileRefineDocumentSchema).min(1),
  // What it may read to understand the first list. Optional so an old client
  // that only sends documents still parses.
  references: z.array(FileRefineReferenceSchema).optional(),
  // The user's plain-language instruction, possibly seeded from a preset.
  instruction: z.string(),
  requestId: z.string(),
});

/**
 * A refine proposal: the whole rewritten text of each document the model chose
 * to change, keyed by the id the request minted. Documents it left alone are
 * simply absent, and ids the request never sent are dropped by the daemon.
 *
 * The client diffs each one against the base it pinned, so a truncated or
 * chatty answer shows up as a diff the user can refuse rather than as a
 * corrupted file.
 */
export const FileRefineFileSchema = z.object({
  id: z.string().min(1),
  content: z.string(),
});

export const FileRefineResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    files: z.array(FileRefineFileSchema),
  }),
  z.object({
    status: z.literal("error"),
    message: z.string(),
  }),
]);

export const FileRefineResponseSchema = z.object({
  type: z.literal("file.refine.response"),
  payload: z.object({
    cwd: z.string(),
    result: FileRefineResultSchema,
    requestId: z.string(),
  }),
});

export type FileRefineRequest = z.infer<typeof FileRefineRequestSchema>;

export type FileRefineDocument = z.infer<typeof FileRefineDocumentSchema>;

export type FileRefineReference = z.infer<typeof FileRefineReferenceSchema>;

export type FileRefineFile = z.infer<typeof FileRefineFileSchema>;

export type FileRefineResponse = z.infer<typeof FileRefineResponseSchema>;

export type FileRefineResult = z.infer<typeof FileRefineResultSchema>;
