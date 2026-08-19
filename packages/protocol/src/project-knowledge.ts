import { z } from "zod";

/**
 * Otto project-knowledge wire schemas: the project.knowledge.* RPCs and the delivery, reference and progress payloads they carry. Fork-only capability, so it owns its schemas; messages.ts re-exports them.
 */

// Repo-owned project knowledge is canonical Markdown under `.otto/knowledge`,
// with daemon-owned writes so worktrees resolve to one store and every truth
// change retains its timeline evidence.
export const ProjectKnowledgeKindSchema = z.enum([
  "decision",
  "constraint",
  "requirement",
  "architecture",
  "finding",
  "project",
  "reference",
]);

export const ProjectKnowledgeStatusSchema = z.enum(["proposed", "confirmed", "superseded"]);

export const ProjectDeliveryStatusSchema = z.enum([
  "charter",
  "in_build",
  "partial",
  "blocked",
  "complete",
  "reference",
  "deferred",
  "cancelled",
]);

export const ProjectReferenceDispositionSchema = z.enum([
  "unevaluated",
  "read",
  "adopted",
  "rejected",
  "dependency",
]);

export const ProjectProgressSchema = z.object({
  completed: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  unit: z.string().min(1).max(48),
});

export const ProjectKnowledgeRecordSchema = z.object({
  id: z.string(),
  kind: ProjectKnowledgeKindSchema,
  title: z.string(),
  statement: z.string(),
  statementDigest: z.string().optional(),
  evidence: z.string().optional(),
  tags: z.array(z.string()),
  status: ProjectKnowledgeStatusSchema,
  deliveryStatus: ProjectDeliveryStatusSchema.optional(),
  progress: ProjectProgressSchema.optional(),
  referenceDisposition: ProjectReferenceDispositionSchema.optional(),
  sourceUrl: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  provenance: z
    .array(
      z.object({
        text: z.string(),
        recordedAt: z.string(),
        source: z.string().optional(),
        kind: z.string().optional(),
        affects: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  path: z.string().optional(),
});

/** Review health, not a persisted project-knowledge finding record. */
export const ProjectKnowledgeHealthSchema = z.object({
  kind: z.enum(["stale", "overlapping_tags", "overlapping_statement"]),
  recordId: z.string(),
  relatedRecordId: z.string().optional(),
  tagOverlap: z.enum(["complete", "partial"]).optional(),
  sharedTags: z.array(z.string()).optional(),
  message: z.string(),
});

export const ProjectKnowledgeRootPageSchema = z.object({
  slug: z.string(),
  title: z.string(),
  path: z.string(),
  body: z.string(),
});

export const ProjectKnowledgeListRequestMessageSchema = z.object({
  type: z.literal("project.knowledge.list.request"),
  requestId: z.string(),
  workspaceId: z.string(),
});

export const ProjectKnowledgeListResponseMessageSchema = z.object({
  type: z.literal("project.knowledge.list.response"),
  payload: z.object({
    requestId: z.string(),
    records: z.array(ProjectKnowledgeRecordSchema),
    rootPages: z.array(ProjectKnowledgeRootPageSchema).optional(),
    findings: z.array(ProjectKnowledgeHealthSchema),
    brief: z.string(),
    briefTokens: z.number(),
    includedIds: z.array(z.string()),
    omittedCount: z.number(),
  }),
});

export const ProjectKnowledgeGetRequestMessageSchema = z.object({
  type: z.literal("project.knowledge.get.request"),
  requestId: z.string(),
  workspaceId: z.string(),
  id: z.string(),
});

export const ProjectKnowledgeGetResponseMessageSchema = z.object({
  type: z.literal("project.knowledge.get.response"),
  payload: z.object({ requestId: z.string(), record: ProjectKnowledgeRecordSchema.nullable() }),
});

export const ProjectKnowledgeCreateRequestMessageSchema = z.object({
  type: z.literal("project.knowledge.create.request"),
  requestId: z.string(),
  workspaceId: z.string(),
  id: z.string().optional(),
  kind: ProjectKnowledgeKindSchema,
  title: z.string().max(160),
  statement: z.string(),
  evidence: z.string().optional(),
  tags: z.array(z.string().max(48)).max(32).optional(),
  affects: z.array(z.string()).optional(),
  status: ProjectKnowledgeStatusSchema.optional(),
  deliveryStatus: ProjectDeliveryStatusSchema.optional(),
  progress: ProjectProgressSchema.optional(),
  referenceDisposition: ProjectReferenceDispositionSchema.optional(),
  sourceUrl: z.string().optional(),
});

export const ProjectKnowledgeCreateResponseMessageSchema = z.object({
  type: z.literal("project.knowledge.create.response"),
  payload: z.object({ requestId: z.string(), record: ProjectKnowledgeRecordSchema }),
});

export const ProjectKnowledgeApplyRequestMessageSchema = z.object({
  type: z.literal("project.knowledge.apply.request"),
  requestId: z.string(),
  workspaceId: z.string(),
  id: z.string(),
  title: z.string().max(160).optional(),
  statement: z.string().optional(),
  evidence: z.string().optional(),
  provenanceText: z.string().optional(),
  provenanceSource: z.string().max(160).optional(),
  provenanceAffects: z.array(z.string()).optional(),
  expectedUpdatedAt: z.string().optional(),
});

export const ProjectKnowledgeApplyResponseMessageSchema = z.object({
  type: z.literal("project.knowledge.apply.response"),
  payload: z.object({
    requestId: z.string(),
    record: ProjectKnowledgeRecordSchema.nullable(),
    error: z.string().optional(),
  }),
});

export const ProjectKnowledgeStatusRequestMessageSchema = z.object({
  type: z.literal("project.knowledge.status.request"),
  requestId: z.string(),
  workspaceId: z.string(),
  id: z.string(),
  status: ProjectKnowledgeStatusSchema,
  reason: z.string().optional(),
});

export const ProjectKnowledgeStatusResponseMessageSchema = z.object({
  type: z.literal("project.knowledge.status.response"),
  payload: z.object({ requestId: z.string(), record: ProjectKnowledgeRecordSchema.nullable() }),
});

export const ProjectKnowledgeProjectApplyRequestMessageSchema = z.object({
  type: z.literal("project.knowledge.project.apply.request"),
  requestId: z.string(),
  workspaceId: z.string(),
  id: z.string(),
  deliveryStatus: ProjectDeliveryStatusSchema.optional(),
  progress: ProjectProgressSchema.nullable().optional(),
  reason: z.string(),
  expectedUpdatedAt: z.string().optional(),
});

export const ProjectKnowledgeProjectApplyResponseMessageSchema = z.object({
  type: z.literal("project.knowledge.project.apply.response"),
  payload: z.object({
    requestId: z.string(),
    record: ProjectKnowledgeRecordSchema.nullable(),
    error: z.string().optional(),
  }),
});

export const ProjectKnowledgeReferenceApplyRequestMessageSchema = z.object({
  type: z.literal("project.knowledge.reference.apply.request"),
  requestId: z.string(),
  workspaceId: z.string(),
  id: z.string(),
  disposition: ProjectReferenceDispositionSchema.optional(),
  sourceUrl: z.string().nullable().optional(),
  reason: z.string(),
  expectedUpdatedAt: z.string().optional(),
});

export const ProjectKnowledgeReferenceApplyResponseMessageSchema = z.object({
  type: z.literal("project.knowledge.reference.apply.response"),
  payload: z.object({
    requestId: z.string(),
    record: ProjectKnowledgeRecordSchema.nullable(),
    error: z.string().optional(),
  }),
});

export const ProjectKnowledgeRootApplyRequestMessageSchema = z.object({
  type: z.literal("project.knowledge.root.apply.request"),
  requestId: z.string(),
  workspaceId: z.string(),
  slug: z.string(),
  body: z.string(),
});

export const ProjectKnowledgeRootApplyResponseMessageSchema = z.object({
  type: z.literal("project.knowledge.root.apply.response"),
  payload: z.object({
    requestId: z.string(),
    page: ProjectKnowledgeRootPageSchema.nullable(),
  }),
});

export const ProjectKnowledgeDeleteRequestMessageSchema = z.object({
  type: z.literal("project.knowledge.delete.request"),
  requestId: z.string(),
  workspaceId: z.string(),
  id: z.string(),
  reason: z.string(),
  expectedUpdatedAt: z.string().optional(),
});

export const ProjectKnowledgeDeleteResponseMessageSchema = z.object({
  type: z.literal("project.knowledge.delete.response"),
  payload: z.object({
    requestId: z.string(),
    deleted: z.boolean(),
    error: z.string().optional(),
  }),
});

export type ProjectKnowledgeListResponseMessage = z.infer<
  typeof ProjectKnowledgeListResponseMessageSchema
>;

export type ProjectKnowledgeGetResponseMessage = z.infer<
  typeof ProjectKnowledgeGetResponseMessageSchema
>;

export type ProjectKnowledgeCreateResponseMessage = z.infer<
  typeof ProjectKnowledgeCreateResponseMessageSchema
>;

export type ProjectKnowledgeApplyResponseMessage = z.infer<
  typeof ProjectKnowledgeApplyResponseMessageSchema
>;

export type ProjectKnowledgeStatusResponseMessage = z.infer<
  typeof ProjectKnowledgeStatusResponseMessageSchema
>;

export type ProjectKnowledgeProjectApplyResponseMessage = z.infer<
  typeof ProjectKnowledgeProjectApplyResponseMessageSchema
>;

export type ProjectKnowledgeReferenceApplyResponseMessage = z.infer<
  typeof ProjectKnowledgeReferenceApplyResponseMessageSchema
>;

export type ProjectKnowledgeRootApplyResponseMessage = z.infer<
  typeof ProjectKnowledgeRootApplyResponseMessageSchema
>;

export type ProjectKnowledgeDeleteResponseMessage = z.infer<
  typeof ProjectKnowledgeDeleteResponseMessageSchema
>;
