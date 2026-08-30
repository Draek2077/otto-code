import { z } from "zod";

export const ArchitecturalViewIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);

export const ArchitecturalViewKnowledgeReferenceSchema = z.object({
  kind: z.enum(["root", "record"]),
  id: z.string().min(1),
});

export const ArchitecturalViewsDeliverRequestSchema = z.object({
  type: z.literal("architectural-views.deliver.request"),
  workspaceId: z.string(),
  viewId: ArchitecturalViewIdSchema,
  title: z.string().min(1),
  knowledgeReferences: z.array(ArchitecturalViewKnowledgeReferenceSchema).min(1),
  sourcePath: z.string().min(1),
  quality: z.enum(["standard", "showcase"]).optional(),
  requestId: z.string(),
});

export const ArchitecturalViewsDeliverResponseSchema = z.object({
  type: z.literal("architectural-views.deliver.response"),
  payload: z.object({
    requestId: z.string(),
    success: z.boolean(),
    viewId: ArchitecturalViewIdSchema,
    storeLocation: z.enum(["repository", "host"]).nullable(),
    htmlPath: z.string().nullable(),
    error: z.string().nullable(),
  }),
});

export const ArchitecturalViewSummarySchema = z.object({
  id: ArchitecturalViewIdSchema,
  title: z.string(),
  knowledgeReferences: z.array(ArchitecturalViewKnowledgeReferenceSchema),
  storeLocation: z.enum(["repository", "host"]),
  htmlPath: z.string(),
  renderedAt: z.string(),
  // COMPAT(architecturalViewSourceStatus): added in v0.9.0, remove after 2027-02-28.
  sourceStatus: z.enum(["current", "stale", "unknown"]).optional(),
});

export const ArchitecturalViewDraftSchema = z.object({
  id: ArchitecturalViewIdSchema,
  viewId: ArchitecturalViewIdSchema,
  title: z.string(),
  knowledgeReferences: z.array(ArchitecturalViewKnowledgeReferenceSchema),
  baseSpecificationSha256: z.string().nullable(),
  // COMPAT(architecturalViewDraftAuthoring): added in v0.9.0, remove after 2027-02-28.
  authoringAgentId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ArchitecturalViewsDraftCreateRequestSchema = z.object({
  type: z.literal("architectural-views.draft.create.request"),
  workspaceId: z.string(),
  viewId: ArchitecturalViewIdSchema,
  draftId: ArchitecturalViewIdSchema,
  title: z.string().min(1),
  knowledgeReferences: z.array(ArchitecturalViewKnowledgeReferenceSchema).min(1),
  sourcePath: z.string().min(1).optional(),
  quality: z.enum(["standard", "showcase"]).optional(),
  requestId: z.string(),
});

export const ArchitecturalViewsDraftCreateResponseSchema = z.object({
  type: z.literal("architectural-views.draft.create.response"),
  payload: z.object({
    requestId: z.string(),
    success: z.boolean(),
    draft: ArchitecturalViewDraftSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const ArchitecturalViewsDraftUpdateRequestSchema = z.object({
  type: z.literal("architectural-views.draft.update.request"),
  workspaceId: z.string(),
  viewId: ArchitecturalViewIdSchema,
  draftId: ArchitecturalViewIdSchema,
  sourcePath: z.string().min(1),
  quality: z.enum(["standard", "showcase"]).optional(),
  requestId: z.string(),
});
export const ArchitecturalViewsDraftUpdateResponseSchema = z.object({
  type: z.literal("architectural-views.draft.update.response"),
  payload: z.object({
    requestId: z.string(),
    success: z.boolean(),
    draft: ArchitecturalViewDraftSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const ArchitecturalViewsDraftPublishRequestSchema = z.object({
  type: z.literal("architectural-views.draft.publish.request"),
  workspaceId: z.string(),
  viewId: ArchitecturalViewIdSchema,
  draftId: ArchitecturalViewIdSchema,
  requestId: z.string(),
});
export const ArchitecturalViewsDraftPublishResponseSchema = z.object({
  type: z.literal("architectural-views.draft.publish.response"),
  payload: z.object({
    requestId: z.string(),
    success: z.boolean(),
    view: ArchitecturalViewSummarySchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const ArchitecturalViewsDraftDiscardRequestSchema = z.object({
  type: z.literal("architectural-views.draft.discard.request"),
  workspaceId: z.string(),
  viewId: ArchitecturalViewIdSchema,
  draftId: ArchitecturalViewIdSchema,
  requestId: z.string(),
});
export const ArchitecturalViewsDraftDiscardResponseSchema = z.object({
  type: z.literal("architectural-views.draft.discard.response"),
  payload: z.object({ requestId: z.string(), success: z.boolean(), error: z.string().nullable() }),
});

export const ArchitecturalViewsDraftGetContentRequestSchema = z.object({
  type: z.literal("architectural-views.draft.get-content.request"),
  workspaceId: z.string(),
  viewId: ArchitecturalViewIdSchema,
  draftId: ArchitecturalViewIdSchema,
  requestId: z.string(),
});

export const ArchitecturalViewsDraftGetContentResponseSchema = z.object({
  type: z.literal("architectural-views.draft.get-content.response"),
  payload: z.object({
    requestId: z.string(),
    success: z.boolean(),
    draft: ArchitecturalViewDraftSchema.nullable(),
    html: z.string().nullable(),
    error: z.string().nullable(),
  }),
});

export const ArchitecturalViewsListRequestSchema = z.object({
  type: z.literal("architectural-views.list.request"),
  workspaceId: z.string(),
  knowledgeReference: ArchitecturalViewKnowledgeReferenceSchema.optional(),
  requestId: z.string(),
});

export const ArchitecturalViewsListResponseSchema = z.object({
  type: z.literal("architectural-views.list.response"),
  payload: z.object({
    requestId: z.string(),
    success: z.boolean(),
    views: z.array(ArchitecturalViewSummarySchema),
    error: z.string().nullable(),
  }),
});

export const ArchitecturalViewsGetContentRequestSchema = z.object({
  type: z.literal("architectural-views.get-content.request"),
  workspaceId: z.string(),
  viewId: ArchitecturalViewIdSchema,
  requestId: z.string(),
});

export const ArchitecturalViewsGetContentResponseSchema = z.object({
  type: z.literal("architectural-views.get-content.response"),
  payload: z.object({
    requestId: z.string(),
    success: z.boolean(),
    view: ArchitecturalViewSummarySchema.nullable(),
    html: z.string().nullable(),
    error: z.string().nullable(),
  }),
});

/** A daemon-routed UI intent emitted only after an agent explicitly asks to show a view. */
export const ArchitecturalViewsOpenNotificationSchema = z.object({
  type: z.literal("architectural-views.open.notification"),
  payload: z.object({
    workspaceId: z.string(),
    agentId: z.string(),
    viewId: ArchitecturalViewIdSchema,
  }),
});

export type ArchitecturalViewsDeliverRequest = z.infer<
  typeof ArchitecturalViewsDeliverRequestSchema
>;
export type ArchitecturalViewsDeliverResponse = z.infer<
  typeof ArchitecturalViewsDeliverResponseSchema
>;
export type ArchitecturalViewsListRequest = z.infer<typeof ArchitecturalViewsListRequestSchema>;
export type ArchitecturalViewsListResponse = z.infer<typeof ArchitecturalViewsListResponseSchema>;
export type ArchitecturalViewsGetContentRequest = z.infer<
  typeof ArchitecturalViewsGetContentRequestSchema
>;
export type ArchitecturalViewsGetContentResponse = z.infer<
  typeof ArchitecturalViewsGetContentResponseSchema
>;
export type ArchitecturalViewsOpenNotification = z.infer<
  typeof ArchitecturalViewsOpenNotificationSchema
>;
export type ArchitecturalViewsDraftGetContentRequest = z.infer<
  typeof ArchitecturalViewsDraftGetContentRequestSchema
>;
export type ArchitecturalViewsDraftGetContentResponse = z.infer<
  typeof ArchitecturalViewsDraftGetContentResponseSchema
>;
