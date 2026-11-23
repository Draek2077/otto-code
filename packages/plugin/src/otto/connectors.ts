import { z } from "zod";
import { defineRpc } from "../rpc.js";
export * from "./connectors/catalog.js";
export * from "./connectors/google.js";

const Id = z.string().min(1).max(256);
const Revision = z.string().min(1).max(256);
const StringMap = z.record(z.string().min(1).max(256), z.string().max(131072));
/** Write-only transport input. Never returned by a read or echoed in an error. */
export const ConnectorTransportSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("stdio"),
      command: z.string().min(1).max(32768),
      args: z.array(z.string().max(32768)).max(256),
      env: StringMap,
    })
    .strict(),
  z
    .object({ type: z.literal("http"), url: z.string().min(1).max(8192), headers: StringMap })
    .strict(),
  z
    .object({ type: z.literal("sse"), url: z.string().min(1).max(8192), headers: StringMap })
    .strict(),
]);
export type ConnectorTransport = z.infer<typeof ConnectorTransportSchema>;
export const ConnectorSetupSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("catalog"),
      catalogId: Id,
      roots: z.array(z.string().min(1).max(32768)).max(32),
      credential: z.string().min(1).max(131072).optional(),
      client: z
        .object({
          clientId: z.string().min(1).max(4096),
          clientSecret: z.string().max(131072).optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("custom"),
      server: ConnectorTransportSchema,
      oauth: z.boolean(),
      scope: z.string().max(8192),
      client: z
        .object({
          clientId: z.string().min(1).max(4096),
          clientSecret: z.string().max(131072).optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
]);
export type ConnectorSetupInput = z.infer<typeof ConnectorSetupSchema>;
export const ConnectorDiscoveredToolSchema = z
  .object({
    name: z.string().min(1).max(256),
    description: z.string().max(16384),
    inputSchema: z.record(z.string(), z.json()),
    readOnly: z.boolean(),
  })
  .strict();
export type ConnectorTool = z.infer<typeof ConnectorDiscoveredToolSchema>;
const ServerSummary = z
  .object({
    type: z.enum(["stdio", "http", "sse", "unavailable"]),
    endpoint: z.string().nullable(),
    command: z.string().nullable(),
    argumentCount: z.number().int().nonnegative(),
    environmentNames: z.array(z.string()),
    headerNames: z.array(z.string()),
  })
  .strict();
export const ConnectorSummarySchema = z
  .object({
    id: Id,
    label: z.string().min(1).max(200),
    catalogId: Id.nullable(),
    enabled: z.boolean(),
    disabledTools: z.array(z.string().max(256)).max(1024),
    server: ServerSummary,
    authorization: z
      .object({
        state: z.enum(["not-required", "disconnected", "pending", "connected", "error"]),
        account: z.string().max(512).nullable(),
        scopes: z.array(z.string().max(1024)).max(256),
        message: z.string().max(2048).nullable(),
      })
      .strict(),
    verification: z
      .object({
        state: z.enum(["unverified", "verified", "failed"]),
        checkedAt: z.string().nullable(),
        fingerprint: z.string().nullable(),
        message: z.string().max(2048).nullable(),
        tools: z.array(ConnectorDiscoveredToolSchema.omit({ inputSchema: true })).max(1024),
        toolCount: z.number().int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();
export type ConnectorSummary = z.infer<typeof ConnectorSummarySchema>;
export const ConnectorsSnapshotSchema = z
  .object({
    revision: Revision,
    connectors: z.array(ConnectorSummarySchema).max(1000),
    detail: ConnectorSummarySchema.optional(),
    providers: z
      .array(
        z
          .object({
            id: z.string(),
            label: z.string(),
            available: z.boolean(),
            reason: z.string().nullable(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type ConnectorsSnapshot = z.infer<typeof ConnectorsSnapshotSchema>;
export const ConnectorActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("add"),
      label: z.string().trim().min(1).max(200),
      setup: ConnectorSetupSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("configure"),
      id: Id,
      label: z.string().trim().min(1).max(200),
      setup: ConnectorSetupSchema.optional(),
    })
    .strict(),
  z.object({ kind: z.literal("enable"), id: Id, enabled: z.boolean() }).strict(),
  z
    .object({
      kind: z.literal("tools"),
      id: Id,
      disabledTools: z.array(z.string().max(256)).max(1024),
    })
    .strict(),
  z.object({ kind: z.literal("remove"), id: Id }).strict(),
  z.object({ kind: z.literal("verify"), id: Id }).strict(),
  z.object({ kind: z.literal("disconnect"), id: Id }).strict(),
]);
export type ConnectorAction = z.infer<typeof ConnectorActionSchema>;
export const ConnectorFailureSchema = z
  .object({
    kind: z.enum(["validation", "conflict", "unavailable", "authorization", "vendor", "uncertain"]),
    message: z.string().max(2048),
  })
  .strict();
function result<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: ConnectorFailureSchema }).strict(),
  ]);
}
export const readConnectors = defineRpc({
  name: "connectors.host.read",
  input: z.object({ hostId: Id, focusId: Id.optional() }).strict(),
  output: result(ConnectorsSnapshotSchema),
});
export const writeConnectors = defineRpc({
  name: "connectors.host.write",
  input: z
    .object({ hostId: Id, expectedRevision: Revision, action: ConnectorActionSchema })
    .strict(),
  output: result(ConnectorsSnapshotSchema),
});
export const authorizeConnector = defineRpc({
  name: "connectors.oauth.begin",
  input: z.object({ hostId: Id, expectedRevision: Revision, id: Id }).strict(),
  output: result(
    z
      .object({
        authorizationUrl: z.string().max(16384).nullable(),
        callback: z.enum(["host-loopback", "hosted"]).optional(),
      })
      .strict(),
  ),
});
