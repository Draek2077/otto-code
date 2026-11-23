import { z } from "zod";
import { defineRpc } from "../../rpc.js";
import { KnowledgeScopeSchema, KnowledgeRootSchema } from "../project-knowledge.js";

export const ViewKind = z.enum(["architecture", "workflow", "sequence", "dataflow", "lifecycle"]);
export const ViewId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/);
export const ViewRevision = z.string().regex(/^[a-f0-9]{64}$/);
export const ViewSpecification = z.record(z.string(), z.json());
/** Explicit preflight before recursive JSON validation, shared by UI/RPC/tools.
 * Wire schemas themselves remain pure structural declarations. */
export function parseViewSpecification(value: unknown): z.infer<typeof ViewSpecification> {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++count > 50000 || item.depth > 32)
      throw new Error("The View exceeds its structural budget.");
    if (item.value === null || typeof item.value !== "object") continue;
    for (const [key, child] of Object.entries(item.value)) {
      if (key === "brand")
        throw new Error("Use semantic component kinds instead of external brand artwork.");
      pending.push({ value: child, depth: item.depth + 1 });
    }
  }
  return ViewSpecification.parse(value);
}
export const ViewReference = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("root"), id: KnowledgeRootSchema }).strict(),
  z.object({ kind: z.literal("record"), id: ViewId }).strict(),
]);
export const ViewOrigin = z.object({
  location: z.enum(["repository", "host"]),
  storeKey: ViewRevision,
});
export const ViewSourceState = z.enum(["current", "stale", "unknown"]);
export const ViewSummary = z.object({
  viewId: ViewId,
  title: z.string().min(1).max(200),
  diagramType: ViewKind,
  origin: ViewOrigin,
  revision: ViewRevision,
  knowledgeReferences: z.array(ViewReference).min(1).max(32),
  renderedAt: z.string().max(64),
  sourceStatus: ViewSourceState,
  state: z.enum(["published", "removed"]),
});
export const ViewDraftBase = z.discriminatedUnion("status", [
  z.object({ status: z.literal("reviewed"), revision: ViewRevision.nullable() }),
  z.object({
    status: z.literal("review_required"),
    legacySpecificationSha256: ViewRevision.nullable(),
  }),
]);
export const ViewDraft = ViewSummary.omit({ renderedAt: true, state: true }).extend({
  draftId: ViewId,
  base: ViewDraftBase,
  authoringAgentId: z.string().max(200).nullable(),
  authoringWorkspaceId: z.string().max(200).nullable(),
  createdAt: z.string().max(64),
  updatedAt: z.string().max(64),
  starter: z.boolean(),
});
export const ViewScope = KnowledgeScopeSchema;
export const ViewIdentity = z.object({ viewId: ViewId, origin: ViewOrigin });
export const ViewSelection = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("published") }).strict(),
  z.object({ kind: z.literal("draft"), draftId: ViewId }).strict(),
  z.object({ kind: z.literal("revision"), revisionId: ViewRevision }).strict(),
]);
export const ViewError = z.object({
  code: z.enum([
    "wrong_host",
    "not_found",
    "invalid",
    "conflict",
    "busy",
    "unavailable",
    "unknown",
  ]),
  message: z.string().max(4000),
});
export function viewResult<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), error: ViewError }),
  ]);
}
const scope = z.object({ scope: ViewScope });
const identity = scope.extend({ identity: ViewIdentity });
const selected = identity.extend({ selection: ViewSelection });
const draft = identity.extend({ draftId: ViewId });
const editDraft = draft.extend({ expectedRevision: ViewRevision });
const operationId = z.string().regex(/^[a-zA-Z0-9_-]{8,120}$/);
const title = z.string().min(1).max(200);
export const ViewCatalog = z.object({
  projectId: z.string().min(1),
  origins: z.array(ViewOrigin).min(1).max(2),
  views: z.array(ViewSummary).max(100),
  drafts: z.array(ViewDraft).max(100),
  diagnostics: z
    .array(
      z.object({ origin: ViewOrigin, viewId: z.string().max(120), message: z.string().max(400) }),
    )
    .max(100),
  nextOffset: z.number().int().nonnegative().nullable(),
  diagnosticsOmitted: z.number().int().nonnegative(),
});
export const ViewDocument = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("published"), view: ViewSummary, specification: ViewSpecification }),
  z.object({ kind: z.literal("revision"), view: ViewSummary, specification: ViewSpecification }),
  z.object({ kind: z.literal("draft"), draft: ViewDraft, specification: ViewSpecification }),
]);
export const readViews = defineRpc({
  name: "architectural.views.catalog.read.request",
  input: scope.extend({
    reference: ViewReference.optional(),
    query: z.string().max(200).optional(),
    offset: z.number().int().min(0).max(2000).optional(),
  }),
  output: viewResult(ViewCatalog),
});
export const readView = defineRpc({
  name: "architectural.views.record.read.request",
  input: selected,
  output: viewResult(ViewDocument),
});
export const createViewDraft = defineRpc({
  name: "architectural.views.draft.create.request",
  input: scope.extend({
    viewId: ViewId,
    draftId: ViewId,
    operationId,
    title,
    diagramType: ViewKind,
    knowledgeReferences: z.array(ViewReference).min(1).max(32),
    published: ViewIdentity.extend({ revision: ViewRevision }).nullable(),
    specification: ViewSpecification.optional(),
  }),
  output: viewResult(ViewDraft),
});
export const updateViewDraft = defineRpc({
  name: "architectural.views.draft.update.request",
  input: editDraft.extend({ specification: ViewSpecification, title: title.optional() }),
  output: viewResult(ViewDraft),
});
export const publishViewDraft = defineRpc({
  name: "architectural.views.draft.publish.request",
  input: editDraft.extend({ operationId, userApproved: z.literal(true) }),
  output: viewResult(ViewSummary),
});
export const rebaseViewDraft = defineRpc({
  name: "architectural.views.draft.base.review.request",
  input: editDraft.extend({
    expectedPublishedRevision: ViewRevision.nullable(),
    userApproved: z.literal(true),
  }),
  output: viewResult(ViewDraft),
});
export const discardViewDraft = defineRpc({
  name: "architectural.views.draft.discard.request",
  input: editDraft.extend({ operationId, userApproved: z.literal(true) }),
  output: viewResult(z.object({ discarded: z.literal(true) })),
});
export const ViewContent = z.object({
  contentId: ViewRevision,
  revision: ViewRevision,
  parts: z.number().int().min(1).max(128),
  characters: z.number().int().positive().max(8388608),
});
export const renderView = defineRpc({
  name: "architectural.views.content.prepare.request",
  input: selected.extend({ expectedRevision: ViewRevision }),
  output: viewResult(ViewContent),
});
export const readViewContentPart = defineRpc({
  name: "architectural.views.content.part.read.request",
  input: selected.extend({ contentId: ViewRevision, part: z.number().int().min(0).max(127) }),
  output: viewResult(
    z.object({ contentId: ViewRevision, part: z.number().int(), text: z.string().max(64000) }),
  ),
});
export const listViewRevisions = defineRpc({
  name: "architectural.views.revisions.list.request",
  input: identity.extend({ offset: z.number().int().min(0).max(2000).optional() }),
  output: viewResult(
    z.object({
      revisions: z.array(ViewSummary).max(50),
      nextOffset: z.number().int().nonnegative().nullable(),
    }),
  ),
});
export const removeView = defineRpc({
  name: "architectural.views.record.remove.request",
  input: identity.extend({
    expectedRevision: ViewRevision,
    operationId,
    userApproved: z.literal(true),
  }),
  output: viewResult(z.object({ removed: z.literal(true) })),
});
export const showView = defineRpc({
  name: "architectural.views.open.request",
  input: identity.extend({ workspaceId: z.string().min(1).max(200) }),
  output: viewResult(ViewSummary),
});
export const readViewContract = defineRpc({
  name: "architectural.views.contract.read.request",
  input: scope.extend({ diagramType: ViewKind }),
  output: viewResult(
    z.object({
      diagramType: ViewKind,
      schema: z.string().max(30000),
      commonSchema: z.string().max(15000),
      guidance: z.string().max(12000),
    }),
  ),
});
export const readViewSources = defineRpc({
  name: "architectural.views.sources.read.request",
  input: scope.extend({
    query: z.string().max(200).optional(),
    offset: z.number().int().min(0).max(10000).optional(),
  }),
  output: viewResult(
    z.object({
      sources: z
        .array(
          z.object({
            reference: ViewReference,
            title: z.string().max(512),
            status: z.string().max(20),
          }),
        )
        .max(100),
      nextOffset: z.number().int().nonnegative().nullable(),
    }),
  ),
});
export const inspectViewOperation = defineRpc({
  name: "architectural.views.operation.inspect.request",
  input: identity.extend({ draftId: ViewId.optional(), operationId }),
  output: viewResult(
    z.object({
      publication: ViewSummary.nullable(),
      draft: ViewDraft.nullable(),
      outcome: z.enum(["published", "discarded", "removed", "not_observed"]),
    }),
  ),
});
export const ViewAuthoringSelection = z.object({
  provider: z.string().min(1).max(200),
  model: z.string().min(1).max(300).optional(),
  modeId: z.string().min(1).max(200).optional(),
  thinkingOptionId: z.string().max(200).optional(),
});
export const startViewAuthoring = defineRpc({
  name: "architectural.views.authoring.start.request",
  input: editDraft.extend({
    workspaceId: z.string().min(1).max(200),
    selection: ViewAuthoringSelection,
    userApproved: z.literal(true),
  }),
  output: viewResult(z.object({ draft: ViewDraft, agentId: z.string().min(1).max(200) })),
});
export const detachViewAuthoring = defineRpc({
  name: "architectural.views.authoring.detach.request",
  input: editDraft.extend({ userApproved: z.literal(true) }),
  output: viewResult(ViewDraft),
});
export const VIEW_AUTHORING_LABEL = "otto.architectural-view-draft";
export const ViewAuthoringContext = z.object({
  version: z.literal(1),
  hostId: z.string().min(1),
  workspaceId: z.string().min(1),
  identity: ViewIdentity,
  draftId: ViewId,
});
export function viewAuthoringContext(
  labels: Record<string, unknown> | null | undefined,
  hostId: string,
) {
  const value = labels?.[VIEW_AUTHORING_LABEL];
  if (typeof value !== "string" || value.length > 4000) return null;
  try {
    const parsed = ViewAuthoringContext.safeParse(JSON.parse(value));
    return parsed.success && parsed.data.hostId === hostId ? parsed.data : null;
  } catch {
    return null;
  }
}
export const ViewOpenIntent = z.object({
  cursor: z.string().max(100),
  identity: ViewIdentity.nullable(),
});
export const waitViewChanges = defineRpc({
  name: "architectural.views.changes.wait.request",
  input: scope.extend({
    origin: ViewOrigin,
    leaseId: z.string().min(8).max(120),
    cursor: z.string().max(100).nullable(),
  }),
  output: viewResult(
    z.object({ cursor: z.string().max(100), error: z.string().max(400).nullable() }),
  ),
});
export const releaseViewChanges = defineRpc({
  name: "architectural.views.changes.release.request",
  input: z.object({ leaseId: z.string().min(8).max(120) }),
  output: viewResult(z.object({ released: z.literal(true) })),
});
export const readViewOpenIntent = defineRpc({
  name: "architectural.views.open.read.request",
  input: scope.extend({ workspaceId: z.string().min(1).max(200) }),
  output: viewResult(ViewOpenIntent),
});
export const waitViewOpenIntent = defineRpc({
  name: "architectural.views.open.wait.request",
  input: scope.extend({
    workspaceId: z.string().min(1).max(200),
    leaseId: z.string().min(8).max(120),
    cursor: z.string().max(100).nullable(),
  }),
  output: viewResult(ViewOpenIntent),
});
export type ViewKind = z.infer<typeof ViewKind>;
export type ViewReference = z.infer<typeof ViewReference>;
export type ViewOrigin = z.infer<typeof ViewOrigin>;
export type ViewSummary = z.infer<typeof ViewSummary>;
export type ViewDraft = z.infer<typeof ViewDraft>;
export type ViewScope = z.infer<typeof ViewScope>;
export type ViewIdentity = z.infer<typeof ViewIdentity>;
export type ViewSelection = z.infer<typeof ViewSelection>;
export type ViewContent = z.infer<typeof ViewContent>;
export type ViewSpecification = z.infer<typeof ViewSpecification>;
export type ViewDocument = z.infer<typeof ViewDocument>;
export type ViewCatalog = z.infer<typeof ViewCatalog>;
