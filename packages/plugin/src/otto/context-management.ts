import { z } from "zod";
import { defineRpc } from "../rpc.js";

export const ContextCategorySchema = z.enum([
  "context_files",
  "memory_index",
  "skills_roster",
  "mcp_tools",
  "otto_injected",
  "system_prompt",
]);
export const ContextNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  revision: z.string(),
  scope: z.enum(["host", "project", "subdirectory", "runtime"]),
  costClass: z.enum(["fixed", "conditional", "referenced"]),
  characters: z.number().int().nonnegative(),
  estimatedTokens: z.number().int().nonnegative(),
  editable: z.boolean(),
  category: ContextCategorySchema.optional(),
});
export const ContextEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string().nullable(),
  kind: z.enum(["import", "reference"]),
  target: z.string(),
  editable: z.boolean().optional(),
  resolution: z
    .enum(["resolved", "missing", "outside", "unavailable", "depth_capped", "excluded"])
    .optional(),
});
export const ContextFindingSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "dead_import",
    "dead_reference",
    "import_cycle",
    "depth_capped",
    "duplicate_across_scope",
    "duplicate_within_file",
    "oversized_memory_entry",
  ]),
  nodeId: z.string(),
  sourceRevision: z.string(),
  message: z.string(),
  range: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }),
  line: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  snippet: z.string(),
  relatedNodeIds: z.array(z.string()),
  fixable: z.boolean(),
});
export const ContextReportSchema = z.object({
  revision: z.string(),
  workspaceId: z.string(),
  provider: z.string(),
  agentId: z.string().nullable(),
  capturedAt: z.string(),
  windowTokens: z.number().int().positive(),
  categories: z.array(
    z.object({
      category: ContextCategorySchema,
      visibility: z.enum(["exact_text", "convention", "not_visible"]),
      estimatedTokens: z.number().int().nonnegative().nullable(),
      explanation: z.string(),
    }),
  ),
  nodes: z.array(ContextNodeSchema),
  edges: z.array(ContextEdgeSchema),
  findings: z.array(z.string()),
  findingDetails: z.array(ContextFindingSchema).optional(),
  fixedTokens: z.number().int().nonnegative(),
  workingRoom: z.number().int().nonnegative(),
  sharePercent: z.number().nonnegative(),
  severity: z.enum(["ok", "notice", "warn", "critical"]),
  preparedRequest: z
    .object({ capturedAt: z.string(), phase: z.enum(["prepared", "completed"]) })
    .nullable(),
  instructionState: z.enum(["ready", "blocked", "unknown"]).optional(),
});
const scope = z.object({ hostId: z.string().min(1), workspaceId: z.string().min(1) }).strict();
export const ContextSelectionSchema = scope
  .extend({
    agentId: z.string().min(1).nullable(),
    windowTokens: z.number().int().min(1024).max(10000000),
  })
  .strict();
export function contextResult<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value }),
    z.object({
      ok: z.literal(false),
      error: z.object({
        code: z.enum(["invalid", "not_found", "wrong_host", "conflict", "busy", "unavailable"]),
        message: z.string(),
      }),
    }),
  ]);
}
export const readContextAgents = defineRpc({
  name: "context.agents.read.request",
  input: scope,
  output: contextResult(
    z.array(z.object({ id: z.string(), label: z.string(), provider: z.string() })),
  ),
});
export const readContextReport = defineRpc({
  name: "context.report.read.request",
  input: ContextSelectionSchema,
  output: contextResult(ContextReportSchema),
});
export const readContextPreview = defineRpc({
  name: "context.preview.read.request",
  input: ContextSelectionSchema.extend({
    revision: z.string(),
    category: ContextCategorySchema.nullable(),
    nodeId: z.string().nullable(),
  }).strict(),
  output: contextResult(z.object({ text: z.string(), revision: z.string(), label: z.string() })),
});
export const changeContextEdge = defineRpc({
  name: "context.edge.change.request",
  input: ContextSelectionSchema.extend({
    revision: z.string(),
    edgeId: z.string(),
    mode: z.enum(["import", "reference"]),
  }).strict(),
  output: contextResult(z.object({ changed: z.boolean() })),
});
// OTTO(context-source): current file bytes have their own CAS revision, separate from captured prompt text.
export const ContextSourceFileSchema = z.object({
  nodeId: z.string(),
  label: z.string(),
  text: z.string(),
  revision: z.string(),
  scope: z.enum(["host", "project", "subdirectory"]),
  writable: z.boolean(),
  readOnlyReason: z.string().nullable(),
});
export const readContextSourceFile = defineRpc({
  name: "context.source.read.request",
  input: ContextSelectionSchema.extend({ nodeId: z.string().min(1) }).strict(),
  output: contextResult(ContextSourceFileSchema),
});
export const saveContextSourceFile = defineRpc({
  name: "context.source.save.request",
  input: ContextSelectionSchema.extend({
    nodeId: z.string().min(1),
    expectedRevision: z.string().min(1),
    text: z.string().max(131072),
    userApprovedSave: z.boolean(),
    userApprovedGlobal: z.boolean(),
  }).strict(),
  output: contextResult(z.object({ changed: z.boolean(), revision: z.string() })),
});
export const ContextFixOutcomeSchema = z.object({
  nodeId: z.string(),
  label: z.string(),
  status: z.enum(["changed", "unchanged", "conflict", "unavailable"]),
  fixedCount: z.number().int().nonnegative(),
  message: z.string(),
});
export const fixContextFindings = defineRpc({
  name: "context.findings.fix.request",
  input: ContextSelectionSchema.extend({
    revision: z.string(),
    findingIds: z.array(z.string()).min(1).max(256),
    userApprovedFixes: z.boolean(),
  }).strict(),
  output: contextResult(
    z.object({
      files: z.array(ContextFixOutcomeSchema),
    }),
  ),
});
export type ContextReport = z.infer<typeof ContextReportSchema>;
export type ContextSelection = z.infer<typeof ContextSelectionSchema>;
export type ContextCategory = z.infer<typeof ContextCategorySchema>;
export type ContextFinding = z.infer<typeof ContextFindingSchema>;
export type ContextFixOutcome = z.infer<typeof ContextFixOutcomeSchema>;
export type ContextSourceFile = z.infer<typeof ContextSourceFileSchema>;
