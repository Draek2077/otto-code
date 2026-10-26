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
});
export const ContextEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string().nullable(),
  kind: z.enum(["import", "reference"]),
  target: z.string(),
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
  fixedTokens: z.number().int().nonnegative(),
  workingRoom: z.number().int().nonnegative(),
  sharePercent: z.number().nonnegative(),
  severity: z.enum(["ok", "notice", "warn", "critical"]),
  preparedRequest: z
    .object({ capturedAt: z.string(), phase: z.enum(["prepared", "completed"]) })
    .nullable(),
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
export type ContextReport = z.infer<typeof ContextReportSchema>;
export type ContextSelection = z.infer<typeof ContextSelectionSchema>;
export type ContextCategory = z.infer<typeof ContextCategorySchema>;
