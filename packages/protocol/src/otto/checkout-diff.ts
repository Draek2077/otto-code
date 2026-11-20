import { z } from "zod";

// Highlighted diff token schema
// Note: style can be a compound class name (e.g., "heading meta") from the syntax highlighter
const HighlightTokenSchema = z.object({
  text: z.string(),
  style: z.string().nullable(),
});

const DiffLineSchema = z.object({
  type: z.enum(["add", "remove", "context", "header"]),
  content: z.string(),
  tokens: z.array(HighlightTokenSchema).optional(),
});

const DiffHunkSchema = z.object({
  oldStart: z.number(),
  oldCount: z.number(),
  newStart: z.number(),
  newCount: z.number(),
  lines: z.array(DiffLineSchema),
});

export const ParsedDiffFileSchema = z.object({
  // OTTO(file-history): share the canonical diff schema.
  path: z.string(),
  // COMPAT(diffOldPath): added in v0.3.0, remove gate after 2027-02-09.
  oldPath: z.string().optional(),
  isNew: z.boolean(),
  isDeleted: z.boolean(),
  additions: z.number(),
  deletions: z.number(),
  hunks: z.array(DiffHunkSchema),
  status: z.enum(["ok", "too_large", "binary"]).optional(),
  // OTTO(structural-diff): optional bounded, complete source pair from the patch snapshot.
  structuralSource: z
    .object({ before: z.string().max(16000), after: z.string().max(16000) })
    .optional(),
});
