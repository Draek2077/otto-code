import { z } from "zod";
import { defineRpc } from "../rpc.js";

export const KnowledgeKindSchema = z.enum([
  "decision",
  "constraint",
  "requirement",
  "architecture",
  "finding",
  "project",
  "reference",
]);
export const KnowledgeReviewSchema = z.enum(["proposed", "confirmed", "superseded"]);
export const KnowledgeRootSchema = z.enum([
  "background",
  "architecture",
  "flow",
  "mindmap",
  "stack",
  "roadmap",
]);
export const KnowledgeDeliverySchema = z.enum([
  "charter",
  "in_build",
  "partial",
  "blocked",
  "complete",
  "reference",
  "deferred",
  "cancelled",
]);
export const KnowledgeDispositionSchema = z.enum([
  "unevaluated",
  "read",
  "adopted",
  "rejected",
  "dependency",
]);
export const KnowledgeProgressSchema = z.object({
  completed: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  unit: z.string().min(1).max(48),
});
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/);
const revision = z.string().length(64);
const text = z.string().min(1).max(524288);
const reason = z.string().trim().min(1).max(65536);
const title = z.string().trim().min(1).max(512);
const tags = z.array(z.string().trim().min(1).max(128)).max(100);
export const KnowledgeScopeSchema = z
  .object({
    hostId: z.string().min(1),
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("project"), id: z.string().min(1) }).strict(),
      z.object({ kind: z.literal("workspace"), id: z.string().min(1) }).strict(),
    ]),
  })
  .strict();
export const KnowledgeSummarySchema = z.object({
  id,
  kind: KnowledgeKindSchema,
  title,
  status: KnowledgeReviewSchema,
  tags,
  updatedAt: z.string(),
  revision,
});
export const KnowledgePageSchema = KnowledgeSummarySchema.extend({
  statement: z.string(),
  timeline: z.string(),
  deliveryStatus: KnowledgeDeliverySchema.nullable(),
  referenceDisposition: KnowledgeDispositionSchema.nullable(),
  sourceUrl: z.string().nullable(),
  progress: KnowledgeProgressSchema.extend({ percentage: z.number() }).nullable(),
});
export const KnowledgeSettingsSchema = z.object({
  projectId: z.string(),
  label: z.string(),
  revision: z.string(),
  location: z.enum(["repository", "host"]),
  override: z.enum(["repository", "host"]).nullable(),
  directoryName: z.string().nullable(),
  path: z.string(),
});
function result<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value }),
    z.object({
      ok: z.literal(false),
      error: z.object({
        code: z.enum(["wrong_host", "not_found", "invalid", "conflict", "busy", "unavailable"]),
        message: z.string(),
      }),
    }),
  ]);
}
const pageTarget = { kind: KnowledgeKindSchema, id };
const editTarget = { ...pageTarget, expectedRevision: revision };
export const KnowledgeCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), ...pageTarget, title, statement: text, tags }).strict(),
  z.object({ action: z.literal("truth"), ...editTarget, statement: text, reason }).strict(),
  z.object({ action: z.literal("describe"), ...editTarget, title, tags, reason }).strict(),
  z
    .object({
      action: z.literal("evidence"),
      ...editTarget,
      text,
      source: z.string().max(2048).optional(),
    })
    .strict(),
  z
    .object({ action: z.literal("review"), ...editTarget, status: KnowledgeReviewSchema, reason })
    .strict(),
  z
    .object({
      action: z.literal("delivery"),
      ...editTarget,
      deliveryStatus: KnowledgeDeliverySchema,
      progress: KnowledgeProgressSchema.nullable().optional(),
      reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("reference"),
      ...editTarget,
      disposition: KnowledgeDispositionSchema,
      sourceUrl: z.string().max(2048).nullable().optional(),
      reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("root"),
      slug: KnowledgeRootSchema,
      expectedRevision: revision.nullable(),
      body: z.string().max(524288),
    })
    .strict(),
  z.object({ action: z.literal("initialize") }).strict(),
]);
export const readKnowledgeCatalog = defineRpc({
  name: "knowledge.project.catalog",
  input: z
    .object({
      scope: KnowledgeScopeSchema,
      includeInactive: z.boolean(),
      query: z.string().max(256),
      offset: z.number().int().nonnegative(),
      limit: z.number().int().min(1).max(200),
    })
    .strict(),
  output: result(
    z.object({
      settings: KnowledgeSettingsSchema,
      records: z.array(KnowledgeSummarySchema),
      total: z.number().int(),
      nextOffset: z.number().int().nullable(),
      roots: z.array(z.object({ slug: KnowledgeRootSchema, revision: revision.nullable() })),
    }),
  ),
});
export const readKnowledgePage = defineRpc({
  name: "knowledge.project.page",
  input: z.object({ scope: KnowledgeScopeSchema, ...pageTarget }).strict(),
  output: result(KnowledgePageSchema),
});
export const readKnowledgeRoot = defineRpc({
  name: "knowledge.project.root",
  input: z.object({ scope: KnowledgeScopeSchema, slug: KnowledgeRootSchema }).strict(),
  output: result(z.object({ body: z.string(), revision }).nullable()),
});
export const mutateKnowledge = defineRpc({
  name: "knowledge.project.mutate",
  input: z.object({ scope: KnowledgeScopeSchema, command: KnowledgeCommandSchema }).strict(),
  output: result(z.object({ changed: z.literal(true) })),
});
export const setKnowledgeLocation = defineRpc({
  name: "knowledge.project.location",
  input: z
    .object({
      scope: KnowledgeScopeSchema,
      expectedRevision: z.string().min(1),
      location: z.enum(["repository", "host"]),
    })
    .strict(),
  output: result(z.object({ copied: z.number().int().nonnegative() })),
});
export const waitKnowledgeChanges = defineRpc({
  name: "knowledge.project.changes.wait.request",
  input: z
    .object({
      scope: KnowledgeScopeSchema,
      leaseId: z.string().uuid(),
      cursor: z.string().nullable(),
    })
    .strict(),
  output: result(z.object({ cursor: z.string(), error: z.string().nullable() })),
});
export const releaseKnowledgeChanges = defineRpc({
  name: "knowledge.project.changes.release.request",
  input: z.object({ leaseId: z.string().uuid() }).strict(),
  output: result(z.object({ released: z.literal(true) })),
});
export type KnowledgeScope = z.infer<typeof KnowledgeScopeSchema>;
export type KnowledgeCommand = z.infer<typeof KnowledgeCommandSchema>;
export type KnowledgeRecord = z.infer<typeof KnowledgePageSchema>;
export type KnowledgeCatalog = Extract<
  z.infer<typeof readKnowledgeCatalog.output>,
  { ok: true }
>["value"];
