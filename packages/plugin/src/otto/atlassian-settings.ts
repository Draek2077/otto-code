import { z } from "zod";
import { defineRpc } from "../rpc.js";

export const AtlassianRouteSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("site") }).strict(),
  z
    .object({ kind: z.literal("scoped"), cloudId: z.string().regex(/^[a-zA-Z0-9-]{1,128}$/) })
    .strict(),
]);
export const AtlassianConfigSchema = z
  .object({
    email: z.string().trim().min(1).max(320),
    siteUrl: z.string().max(2048),
    route: AtlassianRouteSchema,
  })
  .strict();
export const AtlassianAccountSnapshotSchema = z
  .object({
    revision: z.string().min(1),
    config: AtlassianConfigSchema.nullable(),
    credential: z
      .object({ stored: z.boolean(), source: z.enum(["stored", "preserved", "none"]) })
      .strict(),
  })
  .strict();
export const AtlassianCredentialIntentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("keep") }).strict(),
  z.object({ kind: z.literal("remove") }).strict(),
  z.object({ kind: z.literal("replace"), value: z.string().min(1).max(131072) }).strict(),
]);
export const SaveAtlassianAccountSchema = z
  .object({
    expectedRevision: z.string().min(1).max(256),
    config: AtlassianConfigSchema,
    credential: AtlassianCredentialIntentSchema,
  })
  .strict();
const ResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: AtlassianAccountSnapshotSchema }),
  z.object({
    ok: z.literal(false),
    error: z
      .object({
        kind: z.enum(["validation", "conflict", "unavailable"]),
        message: z.string().max(1024),
      })
      .strict(),
  }),
]);
export const readAtlassianAccount = defineRpc({
  name: "integrations.atlassian.read",
  input: z.object({ hostId: z.string().min(1) }).strict(),
  output: ResultSchema,
});
export const saveAtlassianAccount = defineRpc({
  name: "integrations.atlassian.save",
  input: z.object({ hostId: z.string().min(1), ...SaveAtlassianAccountSchema.shape }).strict(),
  output: ResultSchema,
});
export type AtlassianAccountSnapshot = z.infer<typeof AtlassianAccountSnapshotSchema>;
