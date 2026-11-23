import { z } from "zod";
import { defineRpc } from "../rpc.js";
export const PreviewScopeSchema = z.object({
  hostId: z.string().min(1).max(512),
  workspaceId: z.string().min(1).max(512),
});
export type PreviewScope = z.infer<typeof PreviewScopeSchema>;
export const PreviewServerSchema = z.object({
  id: z.string().min(1).max(512),
  name: z.string().max(128),
  cwd: z.string().max(32768),
  port: z.number().int().min(1).max(65535),
  url: z.string().max(8192),
  managed: z.boolean(),
  status: z.enum(["starting", "ready", "error", "stopped"]),
  pid: z.number().int().positive().nullable(),
  error: z.string().max(4000).nullable(),
  browserId: z.string().min(1).max(512).nullable(),
});
export type PreviewServer = z.infer<typeof PreviewServerSchema>;
export const PreviewCommandSchema = z.object({
  name: z.string().min(1).max(128),
  port: z.number().int().min(1).max(65535),
  url: z.string().max(8192),
  command: z.string().max(262144),
  commandRevision: z.string().regex(/^[a-f0-9]{64}$/),
});
function result<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value }),
    z.object({
      ok: z.literal(false),
      error: z.object({ code: z.enum(["invalid", "unavailable"]), message: z.string().max(4000) }),
    }),
  ]);
}
export const readPreviewConfig = defineRpc({
  name: "preview.config.read.request",
  input: PreviewScopeSchema,
  output: result(
    z.object({
      configured: z.boolean(),
      configError: z.string().max(4000).nullable(),
      revision: z.string().nullable(),
      cwd: z.string(),
      commands: z.array(PreviewCommandSchema).max(64),
      servers: z.array(PreviewServerSchema).max(256),
    }),
  ),
});
export const startPreviewServer = defineRpc({
  name: "preview.server.start.request",
  input: PreviewScopeSchema.extend({
    name: z.string().min(1).max(128),
    commandRevision: z.string().regex(/^[a-f0-9]{64}$/),
    userApprovedStart: z.literal(true),
  }),
  output: result(
    z.object({
      server: PreviewServerSchema,
      reused: z.boolean(),
      browserError: z.string().max(4000).nullable(),
    }),
  ),
});
export const stopPreviewServer = defineRpc({
  name: "preview.server.stop.request",
  input: PreviewScopeSchema.extend({
    serverId: z.string().min(1).max(512),
    userApprovedStop: z.literal(true),
  }),
  output: result(PreviewServerSchema),
});
export const openPreviewBrowser = defineRpc({
  name: "preview.browser.open.request",
  input: PreviewScopeSchema.extend({ serverId: z.string().min(1).max(512) }),
  output: result(z.object({ browserId: z.string().min(1).max(512) })),
});
export const readPreviewLogs = defineRpc({
  name: "preview.logs.read.request",
  input: PreviewScopeSchema.extend({
    serverId: z.string().min(1).max(512),
    lines: z.number().int().min(1).max(2000).optional(),
    search: z.string().max(512).optional(),
    level: z.enum(["all", "error"]).optional(),
  }),
  output: result(
    z
      .array(
        z.object({
          sequence: z.number().int().positive(),
          source: z.enum(["stdout", "stderr"]),
          text: z.string().max(1000),
        }),
      )
      .max(2000),
  ),
});
