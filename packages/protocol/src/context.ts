import { z } from "zod";

/**
 * Otto Context Management wire schemas: the context report, findings, prompt
 * preview and edge-conversion RPCs (see docs/context-management.md).
 *
 * Context Management is a fork-only capability, so its schemas live in their own
 * protocol module rather than inside messages.ts, matching kanban.ts, brain.ts
 * and the other Otto domains. messages.ts re-exports them for back-compat.
 */

// Context Management - the daemon's accounting of everything a provider sends
// before the user types (see docs/context-management.md).
//
// Two distinctions carry the whole feature and must not be collapsed on the
// wire: an `import` edge is inlined into the request while a `reference` edge
// costs only its link text, and `costClass` separates weight that rides every
// request from weight that loads only when the agent touches an area.
//
// All numbers are estimates (chars/4) and `confidence` says how much to trust
// the file set: `exact` when Otto composed the payload itself, `convention`
// when resolved from a provider's documented layout, `unverified` for
// subprocess-owned agents we cannot see into.
// COMPAT(contextManagement): added in v0.6.5, drop the gate when daemon floor >= v0.6.5.
export const ContextScopeSchema = z.enum([
  "enterprise",
  "global",
  "project",
  "local",
  "subdirectory",
  "runtime",
]);

export const ContextCategorySchema = z.enum([
  "context_files",
  "memory_index",
  "skills_roster",
  "mcp_tools",
  "otto_injected",
  "system_prompt",
]);

export const ContextCostClassSchema = z.enum(["fixed", "conditional", "referenced"]);

export const ContextSeveritySchema = z.enum(["ok", "notice", "warn", "critical"]);

export const ContextConfidenceSchema = z.enum(["exact", "convention", "unverified"]);

// Per-category disclosure of how well the daemon can see a provider's payload.
// `not_visible` is the reason this exists: a CLI-backed provider composes its
// own preset and hands MCP servers to a subprocess, so those categories are
// unmeasurable rather than empty, and the row has to be able to say which.
export const ContextCategoryVisibilitySchema = z.enum([
  "exact",
  "convention",
  "unverified",
  "not_visible",
]);

export const ContextFindingKindSchema = z.enum([
  "dead_import",
  "dead_reference",
  "duplicate_across_scope",
  "duplicate_within_file",
  "oversized_memory_entry",
  "import_cycle",
  "depth_capped",
]);

export const ContextRangeSchema = z.object({
  start: z.number(),
  end: z.number(),
});

export const ContextFindingSchema = z.object({
  kind: ContextFindingKindSchema,
  message: z.string(),
  range: ContextRangeSchema.optional(),
  relatedNodeIds: z.array(z.string()).optional(),
  // The node this finding is about. Redundant while the finding sits on its
  // node, load-bearing once the report flattens them all into one list - that
  // list is the "Issues" tab, and without this a row cannot say where it came
  // from or take you there.
  nodeId: z.string().optional(),
  // 1-based line of `range.start` in that node's file, so the fix list can jump
  // the editor without the client re-reading bytes to count newlines.
  line: z.number().optional(),
  // Last line of the range, so the client can select the whole offending span
  // rather than dropping a cursor at the top of it.
  lineEnd: z.number().optional(),
  // True for kinds a mechanical delete can resolve on its own (dead links, a
  // duplicate block) - false/absent for kinds that need judgment (which side
  // of an import cycle to cut, how to split an oversized entry). Computed
  // server-side, once, in `locateFinding` - the only place that knows the kind
  // vocabulary, so the fix-all button never has to guess.
  fixable: z.boolean().optional(),
  // The exact text at `range` when the file was scanned. `context.findings.fix`
  // verifies this still matches before deleting, the same staleness guard
  // `context.edge.convert` uses for `rawTarget`.
  snippet: z.string().optional(),
});

export const ContextNodeSchema = z.object({
  id: z.string(),
  path: z.string(),
  relPath: z.string(),
  scope: ContextScopeSchema,
  category: ContextCategorySchema,
  costClass: ContextCostClassSchema,
  bytes: z.number(),
  estTokens: z.number(),
  // Extra parents that also reach this node. The node is listed and counted
  // exactly once; these render as a dimmed "also imported by" chip.
  alsoImportedByNodeIds: z.array(z.string()),
  findings: z.array(ContextFindingSchema),
});

export const ContextEdgeSchema = z.object({
  fromNodeId: z.string(),
  // Null when the target could not be resolved - pairs with a dead_* finding.
  toNodeId: z.string().nullable(),
  kind: z.enum(["import", "reference"]),
  rawTarget: z.string(),
  // Byte range of the whole reference token in the parent file, which is what
  // makes "Always load" <-> "Link only" a single-span edit.
  range: ContextRangeSchema,
});

export const ContextCategoryTotalSchema = z.object({
  category: ContextCategorySchema,
  estTokens: z.number(),
  sharePercent: z.number(),
  severity: ContextSeveritySchema,
  // COMPAT(contextCategoryVisibility): added in v0.7.1, drop the optionality
  // when the floor is >= v0.7.1. An older client ignores the field and still
  // gets correct totals; a newer client seeing it absent renders no badge.
  visibility: ContextCategoryVisibilitySchema.optional(),
});

export const ContextReportSchema = z.object({
  workspaceId: z.string(),
  provider: z.string(),
  // The window the report was evaluated against - from the active model, or
  // the client's what-if picker. Severity is meaningless without it.
  windowTokens: z.number(),
  scannedAt: z.string(),
  confidence: ContextConfidenceSchema,
  supported: z.boolean(),
  supportsImports: z.boolean(),
  nodes: z.array(ContextNodeSchema),
  edges: z.array(ContextEdgeSchema),
  categoryTotals: z.array(ContextCategoryTotalSchema),
  fixedTotal: z.number(),
  conditionalTotal: z.number(),
  referencedTotal: z.number(),
  workingRoom: z.number(),
  aggregateSeverity: ContextSeveritySchema,
  findings: z.array(ContextFindingSchema),
  // Which personality this report was evaluated FOR. Context became
  // personality-specific once personalities accrue memory, so a report is only
  // interpretable alongside the identity it was measured against.
  // COMPAT(personalityMemory): additive; absent = the pre-memory, personality-agnostic report.
  personalityId: z.string().optional(),
  // That personality's injected memory brief, in tokens. Folded into the
  // `otto_injected` category total rather than a new category: ContextCategory
  // is a z.enum travelling daemon->client, so a new member would make a new
  // daemon's report unparseable by an older client.
  personalityMemoryTokens: z.number().optional(),
  // COMPAT(projectKnowledge): additive; repo-owned knowledge is folded into
  // otto_injected, while this field keeps its recurring cost inspectable.
  projectKnowledgeTokens: z.number().optional(),
});

// Pushed with the full current report whenever a watched context file changes.
// Full-report reconciliation, same idiom as suggested_tasks_changed.
export const ContextReportChangedSchema = z.object({
  type: z.literal("context_report_changed"),
  payload: z.object({
    workspaceId: z.string(),
    report: ContextReportSchema.nullable(),
  }),
});

// `provider` and `windowTokens` are the what-if pickers: omitted means "the
// active agent's provider and its model's real window".
export const ContextReportGetRequestMessageSchema = z.object({
  type: z.literal("context.report.get.request"),
  requestId: z.string(),
  workspaceId: z.string(),
  provider: z.string().optional(),
  windowTokens: z.number().optional(),
  // "Evaluate as if this personality were running here": folds that
  // personality's injected memory brief into the report's fixed weight. Omitted
  // means the personality-agnostic report.
  personalityId: z.string().optional(),
});

export const ContextReportGetResponseMessageSchema = z.object({
  type: z.literal("context.report.get.response"),
  payload: z.object({
    requestId: z.string(),
    report: ContextReportSchema.nullable(),
  }),
});

// One readable block of the assembled prompt. `text` is absent exactly when
// `visibility` is "not_visible" - the provider composes that part internally and
// Otto has nothing to show, which the section states rather than hides.
export const ContextPromptSectionSchema = z.object({
  category: ContextCategorySchema,
  label: z.string(),
  visibility: ContextCategoryVisibilitySchema,
  text: z.string().optional(),
  estTokens: z.number(),
});

export const ContextPromptPreviewSchema = z.object({
  sections: z.array(ContextPromptSectionSchema),
  estTokens: z.number(),
});

// Read-only by design: there is no matching write RPC. Editing happens per file
// through the existing file pane, against the real file rather than a
// concatenation of several.
export const ContextPromptPreviewGetRequestMessageSchema = z.object({
  type: z.literal("context.prompt.preview.get.request"),
  requestId: z.string(),
  workspaceId: z.string(),
  provider: z.string().optional(),
  windowTokens: z.number().optional(),
  personalityId: z.string().optional(),
  // Assemble only this category. The tab reads one section at a time - the user
  // clicked a row in the tree - and assembling the rest would re-read every
  // context file on disk to build text nobody asked to see. Omitted means all,
  // which is what an older client sends.
  category: ContextCategorySchema.optional(),
});

export const ContextPromptPreviewGetResponseMessageSchema = z.object({
  type: z.literal("context.prompt.preview.get.response"),
  payload: z.object({
    requestId: z.string(),
    preview: ContextPromptPreviewSchema.nullable(),
  }),
});

// Converts one edge between "always loaded" and "link only". Server-side
// because the parent file may live outside the workspace root.
export const ContextEdgeConvertRequestMessageSchema = z.object({
  type: z.literal("context.edge.convert.request"),
  requestId: z.string(),
  workspaceId: z.string(),
  // The parent file holding the reference - its `ContextNode.path`, not its
  // id: ids are case-folded on Windows and are not safe to write through.
  filePath: z.string(),
  rawTarget: z.string(),
  range: ContextRangeSchema,
  target: z.enum(["import", "reference"]),
});

export const ContextEdgeConvertResponseMessageSchema = z.object({
  type: z.literal("context.edge.convert.response"),
  payload: z.object({
    requestId: z.string(),
    ok: z.boolean(),
    error: z.string().optional(),
  }),
});

// Deletes every mechanically-fixable finding's range in one pass - the
// "Fix all" button in the Issues tab. Each item names the file, the range the
// scan flagged, and the snippet expected there; a file that changed since the
// scan is skipped rather than corrupted (charter §7.5).
export const ContextFindingsFixRequestMessageSchema = z.object({
  type: z.literal("context.findings.fix.request"),
  requestId: z.string(),
  workspaceId: z.string(),
  findings: z.array(
    z.object({
      filePath: z.string(),
      range: ContextRangeSchema,
      snippet: z.string(),
    }),
  ),
});

export const ContextFindingsFixResponseMessageSchema = z.object({
  type: z.literal("context.findings.fix.response"),
  payload: z.object({
    requestId: z.string(),
    fixedCount: z.number(),
    failedCount: z.number(),
    errors: z.array(z.string()),
  }),
});

export type ContextRange = z.infer<typeof ContextRangeSchema>;

export type ContextScope = z.infer<typeof ContextScopeSchema>;

export type ContextCategory = z.infer<typeof ContextCategorySchema>;

export type ContextCategoryVisibility = z.infer<typeof ContextCategoryVisibilitySchema>;

export type ContextCostClass = z.infer<typeof ContextCostClassSchema>;

export type ContextSeverity = z.infer<typeof ContextSeveritySchema>;

export type ContextConfidence = z.infer<typeof ContextConfidenceSchema>;

export type ContextFinding = z.infer<typeof ContextFindingSchema>;

export type ContextNode = z.infer<typeof ContextNodeSchema>;

export type ContextEdge = z.infer<typeof ContextEdgeSchema>;

export type ContextCategoryTotal = z.infer<typeof ContextCategoryTotalSchema>;

export type ContextReport = z.infer<typeof ContextReportSchema>;

export type ContextReportChanged = z.infer<typeof ContextReportChangedSchema>;

export type ContextReportGetResponseMessage = z.infer<typeof ContextReportGetResponseMessageSchema>;

export type ContextPromptSection = z.infer<typeof ContextPromptSectionSchema>;

export type ContextPromptPreview = z.infer<typeof ContextPromptPreviewSchema>;

export type ContextPromptPreviewGetRequestMessage = z.infer<
  typeof ContextPromptPreviewGetRequestMessageSchema
>;

export type ContextPromptPreviewGetResponseMessage = z.infer<
  typeof ContextPromptPreviewGetResponseMessageSchema
>;

export type ContextEdgeConvertResponseMessage = z.infer<
  typeof ContextEdgeConvertResponseMessageSchema
>;

export type ContextFindingsFixResponseMessage = z.infer<
  typeof ContextFindingsFixResponseMessageSchema
>;

export const AgentContextGetUsageRequestMessageSchema = z.object({
  type: z.literal("agent.context.get_usage.request"),
  agentId: z.string(),
  requestId: z.string(),
});

export const AgentContextUsageCategorySchema = z.object({
  /** Provider-supplied display label, e.g. "Messages", "System prompt". Not translated. */
  name: z.string(),
  tokens: z.number(),
  /** Deferred content (e.g. on-demand tool schemas) is not counted in totalTokens. */
  isDeferred: z.boolean().optional(),
});

export const AgentContextUsageSchema = z.object({
  categories: z.array(AgentContextUsageCategorySchema),
  totalTokens: z.number(),
  maxTokens: z.number(),
});

export const AgentContextGetUsageResponseMessageSchema = z.object({
  type: z.literal("agent.context.get_usage.response"),
  payload: z.object({
    requestId: z.string(),
    agentId: z.string(),
    /** Null when the agent's provider cannot report a context breakdown. */
    usage: AgentContextUsageSchema.nullable(),
  }),
});

export type AgentContextUsageCategory = z.infer<typeof AgentContextUsageCategorySchema>;

export type AgentContextUsage = z.infer<typeof AgentContextUsageSchema>;

export type AgentContextGetUsageResponseMessage = z.infer<
  typeof AgentContextGetUsageResponseMessageSchema
>;
