import { z } from "zod";
import { BrowserAutomationBrowserIdSchema } from "../browser-automation/rpc-schemas.js";

const ViewportSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("responsive"),
    width: z.number().int().min(240).max(3840),
    height: z.number().int().min(240).max(2160),
  }),
  z.object({
    mode: z.literal("fixed"),
    width: z.number().int().min(240).max(3840),
    height: z.number().int().min(240).max(2160),
  }),
]);

export const RemoteBrowserCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("list") }),
  z.object({
    kind: z.literal("open"),
    browserId: BrowserAutomationBrowserIdSchema,
    url: z.string().optional(),
    viewport: ViewportSchema.optional(),
  }),
  z.object({ kind: z.literal("get"), browserId: BrowserAutomationBrowserIdSchema }),
  z.object({
    kind: z.literal("frame"),
    browserId: BrowserAutomationBrowserIdSchema,
    knownRevision: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("navigate"),
    browserId: BrowserAutomationBrowserIdSchema,
    url: z.string(),
  }),
  z.object({ kind: z.literal("back"), browserId: BrowserAutomationBrowserIdSchema }),
  z.object({ kind: z.literal("forward"), browserId: BrowserAutomationBrowserIdSchema }),
  z.object({ kind: z.literal("reload"), browserId: BrowserAutomationBrowserIdSchema }),
  z.object({
    kind: z.literal("tap"),
    browserId: BrowserAutomationBrowserIdSchema,
    x: z.number().finite(),
    y: z.number().finite(),
  }),
  z.object({
    kind: z.literal("scroll"),
    browserId: BrowserAutomationBrowserIdSchema,
    x: z.number().finite(),
    y: z.number().finite(),
    deltaX: z.number().finite(),
    deltaY: z.number().finite(),
  }),
  z.object({
    kind: z.literal("type"),
    browserId: BrowserAutomationBrowserIdSchema,
    text: z.string().max(100_000),
  }),
  z.object({
    kind: z.literal("key"),
    browserId: BrowserAutomationBrowserIdSchema,
    key: z.string().min(1).max(100),
  }),
  z.object({
    kind: z.literal("viewport"),
    browserId: BrowserAutomationBrowserIdSchema,
    viewport: ViewportSchema,
  }),
  z.object({ kind: z.literal("suspend"), browserId: BrowserAutomationBrowserIdSchema }),
  z.object({ kind: z.literal("close"), browserId: BrowserAutomationBrowserIdSchema }),
]);

export const RemoteBrowserExecuteRequestSchema = z.object({
  type: z.literal("browser.remote.execute.request"),
  requestId: z.string().min(1),
  workspaceId: z.string().min(1),
  command: RemoteBrowserCommandSchema,
});

export const RemoteBrowserTabSchema = z.object({
  browserId: BrowserAutomationBrowserIdSchema,
  workspaceId: z.string().min(1),
  url: z.string(),
  title: z.string(),
  viewport: ViewportSchema,
  state: z.enum(["suspended", "starting", "ready", "crashed", "quarantined"]),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  error: z.string().nullable(),
  // A host focus request is consumed by each connected workspace client once.
  focusRequestId: z.string().min(1).optional(),
});

export const RemoteBrowserExecuteResponseSchema = z.object({
  type: z.literal("browser.remote.execute.response"),
  payload: z.object({
    requestId: z.string().min(1),
    ok: z.boolean(),
    tab: RemoteBrowserTabSchema.optional(),
    tabs: z.array(RemoteBrowserTabSchema).optional(),
    frame: z
      .object({
        mimeType: z.literal("image/jpeg"),
        dataBase64: z.string(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        revision: z.number().int().nonnegative(),
      })
      .optional(),
    error: z.string().optional(),
  }),
});

export type RemoteBrowserCommand = z.infer<typeof RemoteBrowserCommandSchema>;
export type RemoteBrowserTab = z.infer<typeof RemoteBrowserTabSchema>;
export type RemoteBrowserExecuteRequest = z.infer<typeof RemoteBrowserExecuteRequestSchema>;
export type RemoteBrowserExecuteResponse = z.infer<typeof RemoteBrowserExecuteResponseSchema>;
