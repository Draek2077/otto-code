import { z } from "zod";

/**
 * Otto preview wire schemas (dev-server supervision). Fork-only capability, so it owns its schemas rather than declaring them in messages.ts, matching kanban.ts and artifacts/rpc-schemas.ts.
 */

/**
 * UI-initiated preview RPCs (the Preview toolbar button), distinct from the
 * agent-facing preview_* tools in packages/server/src/server/preview/preview-tools.ts.
 * Both sides drive the same DevServerManager; only the caller differs.
 */
export const PreviewListConfigRequestSchema = z.object({
  type: z.literal("preview.list_config.request"),
  cwd: z.string(),
  requestId: z.string(),
});

export const PreviewStartRequestSchema = z.object({
  type: z.literal("preview.start.request"),
  cwd: z.string(),
  name: z.string(),
  requestId: z.string(),
});

export const PreviewBindTabRequestSchema = z.object({
  type: z.literal("preview.bind_tab.request"),
  serverId: z.string(),
  browserId: z.string(),
  requestId: z.string(),
});

export const PreviewStopRequestSchema = z.object({
  type: z.literal("preview.stop.request"),
  serverId: z.string(),
  requestId: z.string(),
});

export const PreviewConfiguredServerSchema = z.object({
  name: z.string(),
  port: z.number().int().positive(),
});

export const PreviewServerStatusSchema = z.enum(["starting", "running", "exited"]);

export const PreviewRunningServerSchema = z.object({
  serverId: z.string(),
  name: z.string(),
  url: z.string(),
  port: z.number().int().positive(),
  status: PreviewServerStatusSchema,
});

export const PreviewListConfigResponseSchema = z.object({
  type: z.literal("preview.list_config.response"),
  payload: z.object({
    cwd: z.string(),
    configured: z.boolean(),
    servers: z.array(PreviewConfiguredServerSchema),
    runningServers: z.array(PreviewRunningServerSchema).optional(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

// Preview servers the daemon did not spawn (port-probed from launch.json, e.g.
// a dev server the user started by hand) are addressed by an "ext:<port>" id.
// Stopping one tree-kills whatever process owns the port, so bulk cleanup paths
// must skip external servers and only explicit user action may stop them.
export const EXTERNAL_PREVIEW_SERVER_ID_PREFIX = "ext:";

export function isExternalPreviewServerId(serverId: string): boolean {
  return serverId.startsWith(EXTERNAL_PREVIEW_SERVER_ID_PREFIX);
}

export const PreviewServerSummaryPayloadSchema = z.object({
  serverId: z.string(),
  name: z.string(),
  url: z.string(),
  port: z.number().int().positive(),
  status: z.enum(["starting", "running", "exited"]),
  boundBrowserId: z.string().nullable(),
});

export const PreviewStartResponseSchema = z.object({
  type: z.literal("preview.start.response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    server: PreviewServerSummaryPayloadSchema.nullable(),
    reused: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const PreviewBindTabResponseSchema = z.object({
  type: z.literal("preview.bind_tab.response"),
  payload: z.object({
    success: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const PreviewStopResponseSchema = z.object({
  type: z.literal("preview.stop.response"),
  payload: z.object({
    success: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export type PreviewListConfigRequest = z.infer<typeof PreviewListConfigRequestSchema>;

export type PreviewConfiguredServer = z.infer<typeof PreviewConfiguredServerSchema>;

export type PreviewRunningServer = z.infer<typeof PreviewRunningServerSchema>;

export type PreviewServerStatus = z.infer<typeof PreviewServerStatusSchema>;

export type PreviewListConfigResponse = z.infer<typeof PreviewListConfigResponseSchema>;

export type PreviewStartRequest = z.infer<typeof PreviewStartRequestSchema>;

export type PreviewServerSummaryPayload = z.infer<typeof PreviewServerSummaryPayloadSchema>;

export type PreviewStartResponse = z.infer<typeof PreviewStartResponseSchema>;

export type PreviewBindTabRequest = z.infer<typeof PreviewBindTabRequestSchema>;

export type PreviewBindTabResponse = z.infer<typeof PreviewBindTabResponseSchema>;

export type PreviewStopRequest = z.infer<typeof PreviewStopRequestSchema>;

export type PreviewStopResponse = z.infer<typeof PreviewStopResponseSchema>;
