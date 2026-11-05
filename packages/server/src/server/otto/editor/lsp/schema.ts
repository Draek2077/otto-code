import { z } from "zod";

// LSP positions stay zero-based until the presentation boundary. UTF-16 is the
// only advertised encoding and matches CodeMirror/JavaScript string offsets.
export const Position = z.object({
  line: z.number().int().nonnegative(),
  character: z.number().int().nonnegative(),
});
export const Range = z.object({ start: Position, end: Position });
export const Location = z.object({ uri: z.string(), range: Range });
export const LocationLink = z.object({
  targetUri: z.string(),
  targetRange: Range,
  targetSelectionRange: Range,
});
export const Definition = z.union([Location, z.array(Location), z.array(LocationLink), z.null()]);
const MarkedString = z.union([z.string(), z.object({ language: z.string(), value: z.string() })]);
export const Hover = z
  .object({
    contents: z.union([
      MarkedString,
      z.array(MarkedString),
      z.object({ kind: z.enum(["plaintext", "markdown"]), value: z.string() }),
    ]),
    range: Range.optional(),
  })
  .nullable();
export const Diagnostic = z.object({
  range: Range,
  severity: z.number().int().min(1).max(4).optional(),
  message: z.string(),
  source: z.string().optional(),
  code: z.union([z.string(), z.number()]).optional(),
  tags: z.array(z.number()).optional(),
});
export const PublishedDiagnostics = z.object({
  uri: z.string(),
  version: z.number().int().optional(),
  diagnostics: z.array(Diagnostic).max(10000),
});
export type PublishedDiagnostics = z.infer<typeof PublishedDiagnostics>;
export const TextEdit = z.object({ range: Range, newText: z.string() });
export const WorkspaceEdit = z
  .object({
    changes: z.record(z.string(), z.array(TextEdit)).optional(),
    documentChanges: z
      .array(
        z.object({
          textDocument: z.object({ uri: z.string(), version: z.number().nullable() }),
          edits: z.array(TextEdit),
        }),
      )
      .optional(),
  })
  .nullable();
const CompletionItem = z.object({
  label: z.string(),
  kind: z.number().optional(),
  detail: z.string().optional(),
  documentation: z
    .union([z.string(), z.object({ kind: z.string(), value: z.string() })])
    .optional(),
  insertText: z.string().optional(),
  insertTextFormat: z.number().optional(),
  sortText: z.string().optional(),
  filterText: z.string().optional(),
  textEdit: TextEdit.optional(),
  additionalTextEdits: z.array(TextEdit).optional(),
});
export const Completion = z.union([
  z.array(CompletionItem),
  z.object({ isIncomplete: z.boolean(), items: z.array(CompletionItem) }),
  z.null(),
]);
export const Symbol = z.object({
  name: z.string(),
  detail: z.string().optional(),
  kind: z.number(),
  range: Range.optional(),
  selectionRange: Range.optional(),
  location: Location.optional(),
  children: z.array(z.unknown()).optional(),
});
