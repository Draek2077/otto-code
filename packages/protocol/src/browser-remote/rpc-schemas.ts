import { z } from "zod";
import { BrowserAutomationBrowserIdSchema } from "../browser-automation/rpc-schemas.js";

/** Capability leaves for hosted browser operations live with their wire schemas. */
export const RemoteBrowserServerFeaturesShape = {
  // COMPAT(remoteBrowser): added in v0.9.25, remove gate after 2027-03-26.
  remoteBrowser: z.boolean().optional(),
  // COMPAT(remoteBrowserLoadStatus): added in v0.9.26, remove gate after 2027-03-27.
  remoteBrowserLoadStatus: z.boolean().optional(),
  // COMPAT(remoteBrowserGestures): added in v0.9.28, remove gate after 2027-03-29.
  remoteBrowserGestures: z.boolean().optional(),
  // COMPAT(remoteBrowserPinch): added in v0.9.29, remove gate after 2027-04-02.
  remoteBrowserPinch: z.boolean().optional(),
};

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

/**
 * The most text one type command may carry. A paste is clamped to it in the
 * client so an oversized clipboard is truncated rather than rejected on the wire.
 */
export const REMOTE_BROWSER_TYPE_TEXT_MAX = 100_000;

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
    // The host holds the request until the page repaints, up to this long.
    waitMs: z.number().int().positive().max(30_000).optional(),
    // The client takes the picture as a binary frame sent ahead of the response.
    binary: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("navigate"),
    browserId: BrowserAutomationBrowserIdSchema,
    url: z.string(),
  }),
  z.object({ kind: z.literal("back"), browserId: BrowserAutomationBrowserIdSchema }),
  z.object({ kind: z.literal("forward"), browserId: BrowserAutomationBrowserIdSchema }),
  z.object({ kind: z.literal("reload"), browserId: BrowserAutomationBrowserIdSchema }),
  z.object({ kind: z.literal("stop"), browserId: BrowserAutomationBrowserIdSchema }),
  z.object({
    kind: z.literal("tap"),
    browserId: BrowserAutomationBrowserIdSchema,
    x: z.number().finite(),
    y: z.number().finite(),
    // Older hosts still accept a plain tap; gesture-aware hosts read these leaves.
    button: z.enum(["left", "right"]).optional(),
    clickCount: z.union([z.literal(1), z.literal(2)]).optional(),
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
    kind: z.literal("pinch"),
    browserId: BrowserAutomationBrowserIdSchema,
    x: z.number().finite(),
    y: z.number().finite(),
    // A relative scale keeps successive touch or trackpad updates composable.
    scaleFactor: z.number().finite().min(0.5).max(2),
  }),
  z.object({
    kind: z.literal("type"),
    browserId: BrowserAutomationBrowserIdSchema,
    text: z.string().max(REMOTE_BROWSER_TYPE_TEXT_MAX),
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
  isLoading: z.boolean().optional(),
  observationId: z.number().int().nonnegative().optional(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  error: z.string().nullable(),
  // A host focus request is consumed by each connected workspace client once.
  focusRequestId: z.string().min(1).optional(),
  // Set when preview_start opened the tab, so each client adopts it as that
  // server's preview tab.
  preview: z
    .object({ serverId: z.string().min(1), serverName: z.string(), cwd: z.string() })
    .optional(),
  layout: z.enum(["split-right"]).optional(),
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
    // Describes a picture that was sent as a binary frame for this request.
    binaryFrame: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        revision: z.number().int().nonnegative(),
      })
      .optional(),
    // Host-side counters for the tab's frame stream, for monitoring its cost.
    stream: z
      .object({
        captures: z.number().int().nonnegative(),
        pushed: z.number().int().nonnegative(),
        unchanged: z.number().int().nonnegative(),
        framesSent: z.number().int().nonnegative(),
        bytesSent: z.number().int().nonnegative(),
      })
      .optional(),
    error: z.string().optional(),
  }),
});

export type RemoteBrowserCommand = z.infer<typeof RemoteBrowserCommandSchema>;
export type RemoteBrowserTab = z.infer<typeof RemoteBrowserTabSchema>;
export type RemoteBrowserExecuteRequest = z.infer<typeof RemoteBrowserExecuteRequestSchema>;
export type RemoteBrowserExecuteResponse = z.infer<typeof RemoteBrowserExecuteResponseSchema>;
