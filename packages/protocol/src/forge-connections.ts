import { z } from "zod";

// Connection references and account labels are safe to send to clients. Stored
// credentials are deliberately absent from the settings response.
export const ForgeConnectionSchema = z.object({
  id: z.string(),
  forge: z.string(),
  host: z.string(),
  label: z.string(),
  account: z.string(),
  method: z.string(),
  revision: z.number(),
});
export const ForgeConnectionBindingSchema = z.object({
  forge: z.string(),
  host: z.string(),
  connectionId: z.string(),
});
export const ForgeConnectionsOverviewSchema = z.object({
  connections: z.array(ForgeConnectionSchema),
  defaults: z.array(ForgeConnectionBindingSchema),
  overrides: z.array(ForgeConnectionBindingSchema),
  projectId: z.string().nullable(),
});
export const ForgeConnectionsActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("list"), projectId: z.string().optional() }),
  z.object({
    kind: z.literal("save"),
    projectId: z.string().optional(),
    useForScope: z.boolean().optional(),
    id: z.string().optional(),
    expectedRevision: z.number().optional(),
    forge: z.string(),
    host: z.string(),
    label: z.string(),
    method: z.string(),
    account: z.string().optional(),
    // Write-only credential entry. Never echo this field in any response.
    secret: z.string().optional(),
  }),
  z.object({
    kind: z.literal("select"),
    projectId: z.string().optional(),
    forge: z.string(),
    host: z.string(),
    connectionId: z.string().nullable(),
  }),
  z.object({ kind: z.literal("remove"), id: z.string(), expectedRevision: z.number() }),
]);
export const ForgeConnectionsManageRequestSchema = z.object({
  type: z.literal("forge.connections.manage.request"),
  requestId: z.string(),
  action: ForgeConnectionsActionSchema,
});
export const ForgeConnectionsManageResponseSchema = z.object({
  type: z.literal("forge.connections.manage.response"),
  payload: z.object({
    requestId: z.string(),
    overview: ForgeConnectionsOverviewSchema.nullable(),
    error: z.string().nullable(),
  }),
});
export type ForgeConnection = z.infer<typeof ForgeConnectionSchema>;
export type ForgeConnectionBinding = z.infer<typeof ForgeConnectionBindingSchema>;
export type ForgeConnectionsOverview = z.infer<typeof ForgeConnectionsOverviewSchema>;
export type ForgeConnectionsAction = z.infer<typeof ForgeConnectionsActionSchema>;
