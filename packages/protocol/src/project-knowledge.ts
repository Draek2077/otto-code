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

/**
 * Where a project keeps its Knowledge store. `repository` is the historical
 * `.otto/` directory in the working tree; `host` is a directory under the
 * daemon's `$OTTO_HOME`, so the working tree stays clean. `null` on a project
 * means "inherit the host default".
 *
 * Declared up here rather than beside the store RPCs at the bottom of the file:
 * `messages.ts` composes it into the project descriptor, and the AOT validator
 * generator evaluates these modules for real, so a schema referenced by another
 * must already exist when that reference runs.
 * COMPAT(projectKnowledgeStoreLocation): added in v0.8.18.
 */
export const ProjectKnowledgeStoreLocationValueSchema = z.enum(["repository", "host"]);

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
  // Relative to the store's path base: the project root for a repository
  // store, the store directory for a host store. Prefer `absolutePath` when
  // the client needs a path it can actually open.
  path: z.string().optional(),
  // COMPAT(projectKnowledgeStoreLocation): added in v0.8.18; the only path a
  // client can open for a host-local store. Absent from older daemons.
  absolutePath: z.string().optional(),
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
  // COMPAT(projectKnowledgeStoreLocation): added in v0.8.18. See the same field
  // on ProjectKnowledgeRecordSchema.
  absolutePath: z.string().optional(),
  body: z.string(),
  /** Conditional-write precondition for a reviewed root-page refinement. */
  bodyDigest: z.string().optional(),
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
  // COMPAT(projectKnowledgeTagEditing): added in v0.8.21, accepted through
  // 2027-02-27 for clients before tag editing.
  tags: z.array(z.string().max(48)).max(32).optional(),
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

/**
 * A reviewed refinement commits an accepted proposal, not an ordinary edit.
 * Confirmed atomic Knowledge is demoted atomically with its new truth; root
 * pages use a body digest because they have no review state.
 */
export const ProjectKnowledgeRefineApplyRequestMessageSchema = z.object({
  type: z.literal("project.knowledge.refine.apply.request"),
  requestId: z.string(),
  workspaceId: z.string(),
  target: z.enum(["record", "root"]),
  id: z.string().optional(),
  slug: z.string().optional(),
  statement: z.string().optional(),
  // COMPAT(projectKnowledgeEvidenceRefinement): added in v0.8.18, accepted
  // through 2027-02-27 for clients before multi-field record review.
  evidence: z.string().optional(),
  body: z.string().optional(),
  expectedUpdatedAt: z.string().optional(),
  expectedBodyDigest: z.string().optional(),
});

export const ProjectKnowledgeRefineApplyResponseMessageSchema = z.object({
  type: z.literal("project.knowledge.refine.apply.response"),
  payload: z.object({
    requestId: z.string(),
    record: ProjectKnowledgeRecordSchema.nullable(),
    page: ProjectKnowledgeRootPageSchema.nullable(),
    demoted: z.boolean(),
    error: z.string().optional(),
  }),
});

/** An exact source span inside an editable Project Knowledge title or body. */
export const ProjectKnowledgeRefinementAnchorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), start: z.number().int(), end: z.number().int() }),
  z.object({
    kind: z.literal("fence"),
    start: z.number().int(),
    end: z.number().int(),
    language: z.string().nullable(),
  }),
]);

/** A temporary source-bound instruction sent to the dedicated Knowledge writer. */
export const ProjectKnowledgeRefinementDirectiveSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["replace", "refine"]),
  // COMPAT(projectKnowledgePhraseRefinement): accepted through 2027-02-27 for
  // clients before source-owned review anchors.
  selectedText: z.string().optional(),
  beforeContext: z.string().optional(),
  afterContext: z.string().optional(),
  anchor: ProjectKnowledgeRefinementAnchorSchema.optional(),
  value: z.string(),
});

/**
 * Produces one inert Knowledge proposal. Direct replacements have already been
 * applied by the caller; this request carries only the remaining refinement
 * instructions and never writes the store.
 */
export const ProjectKnowledgeRefinementProposeRequestMessageSchema = z.object({
  type: z.literal("project.knowledge.refinement.propose.request"),
  requestId: z.string(),
  workspaceId: z.string(),
  content: z.string(),
  directives: z.array(ProjectKnowledgeRefinementDirectiveSchema),
});

export const ProjectKnowledgeRefinementProposeResponseMessageSchema = z.object({
  type: z.literal("project.knowledge.refinement.propose.response"),
  payload: z.object({
    requestId: z.string(),
    content: z.string().nullable(),
    error: z.string().optional(),
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
export type ProjectKnowledgeRefinementProposeResponseMessage = z.infer<
  typeof ProjectKnowledgeRefinementProposeResponseMessageSchema
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

export type ProjectKnowledgeRefineApplyResponseMessage = z.infer<
  typeof ProjectKnowledgeRefineApplyResponseMessageSchema
>;

export type ProjectKnowledgeDeleteResponseMessage = z.infer<
  typeof ProjectKnowledgeDeleteResponseMessageSchema
>;

// COMPAT(projectKnowledgeStoreLocation): added in v0.8.18, drop the gate when
// floor >= v0.8.18. Gated by server_info features.projectKnowledgeStoreLocation.

/** What the daemon resolved for a workspace, and why the client may act on it. */
export const ProjectKnowledgeStoreDescriptorSchema = z.object({
  location: ProjectKnowledgeStoreLocationValueSchema,
  /** The project's own override; null means it is following the host default. */
  override: ProjectKnowledgeStoreLocationValueSchema.nullable(),
  /** The host default in force, so the UI can label the inherited choice. */
  hostDefault: ProjectKnowledgeStoreLocationValueSchema,
  /** Absolute directory holding `KNOWLEDGE.md` and the `knowledge/` tree. */
  basePath: z.string(),
  /** The project this store belongs to, when the workspace has a registered one. */
  projectId: z.string().nullable(),
  /** Whether the resolved store holds pages a switch would offer to carry over. */
  hasPages: z.boolean(),
  /** Whether the other location already holds pages a switch would land beside. */
  otherLocationHasPages: z.boolean(),
});

/**
 * Addressed by project or by workspace. Project Settings has a project and no
 * open workspace; the Knowledge panel has a workspace and reaches its project
 * through it. Both are optional on the wire and the daemon rejects neither
 * being set, rather than forcing a caller to invent an id it does not have.
 */
export const ProjectKnowledgeStoreGetRequestMessageSchema = z.object({
  type: z.literal("project.knowledge.store.get.request"),
  requestId: z.string(),
  workspaceId: z.string().optional(),
  projectId: z.string().optional(),
});

export const ProjectKnowledgeStoreGetResponseMessageSchema = z.object({
  type: z.literal("project.knowledge.store.get.response"),
  payload: z.object({
    requestId: z.string(),
    store: ProjectKnowledgeStoreDescriptorSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const ProjectKnowledgeStoreSetRequestMessageSchema = z.object({
  type: z.literal("project.knowledge.store.set.request"),
  requestId: z.string(),
  projectId: z.string().min(1),
  /**
   * The workspace whose context report should be refreshed. Optional because
   * the setting is reachable from Project Settings, where no workspace is open.
   */
  workspaceId: z.string().optional(),
  /** Null returns the project to inheriting the host default. */
  location: ProjectKnowledgeStoreLocationValueSchema.nullable(),
  /**
   * Whether to carry the existing pages to the new location. The daemon never
   * decides this: a silent move stages a deletion in the user's working tree.
   */
  movePages: z.boolean().default(false),
});

export const ProjectKnowledgeStoreSetResponseMessageSchema = z.object({
  type: z.literal("project.knowledge.store.set.response"),
  payload: z.object({
    requestId: z.string(),
    projectId: z.string(),
    accepted: z.boolean(),
    store: ProjectKnowledgeStoreDescriptorSchema.nullable(),
    /** Pages actually carried across. Zero when `movePages` was false. */
    movedPageCount: z.number().int().nonnegative(),
    error: z.string().nullable(),
  }),
});

export type ProjectKnowledgeStoreDescriptor = z.infer<typeof ProjectKnowledgeStoreDescriptorSchema>;

export type ProjectKnowledgeStoreGetResponseMessage = z.infer<
  typeof ProjectKnowledgeStoreGetResponseMessageSchema
>;

export type ProjectKnowledgeStoreSetResponseMessage = z.infer<
  typeof ProjectKnowledgeStoreSetResponseMessageSchema
>;

export type ProjectKnowledgeStoreLocationValue = z.infer<
  typeof ProjectKnowledgeStoreLocationValueSchema
>;
