import { z } from "zod";

/**
 * The widget message bridge - the contract between a widget guest (WebView /
 * iframe / Electron <webview>) and its host renderer.
 *
 * Three transports carry the same two message shapes:
 *   native   - `window.ReactNativeWebView.postMessage` + `onMessage`
 *   web      - a `MessageChannel` port transferred in at load
 *   electron - a preload's `ipcRenderer.sendToHost` + the `ipc-message` event
 *
 * The schema lives here, once, so a transport cannot quietly drift. Everything
 * arriving from a guest is untrusted model-generated content: parse, never
 * trust, and drop anything that does not match.
 */

/** Marker on every guest→host frame, so foreign postMessage traffic is ignored. */
export const WIDGET_BRIDGE_CHANNEL = "otto.widget.v1";

/**
 * `sendPrompt` types into the user's chat. That is a privilege, so it is
 * capped: a widget cannot paste an essay, and cannot machine-gun the composer.
 */
export const WIDGET_PROMPT_MAX_CHARS = 2_000;
export const WIDGET_PROMPT_MIN_INTERVAL_MS = 1_000;
/** Total prompts one widget may send in a session, however slowly. */
export const WIDGET_PROMPT_SESSION_LIMIT = 20;

/** Clamp for self-reported guest height, in CSS pixels. */
export const WIDGET_MIN_HEIGHT_PX = 24;
export const WIDGET_MAX_HEIGHT_PX = 4_000;

const WidgetHeightMessageSchema = z.object({
  channel: z.literal(WIDGET_BRIDGE_CHANNEL),
  widgetId: z.string().min(1),
  type: z.literal("height"),
  /** Content height the guest measured for its in-flow content. */
  px: z.number().finite().nonnegative(),
});

const WidgetPromptMessageSchema = z.object({
  channel: z.literal(WIDGET_BRIDGE_CHANNEL),
  widgetId: z.string().min(1),
  type: z.literal("prompt"),
  text: z.string().min(1),
});

const WidgetOpenLinkMessageSchema = z.object({
  channel: z.literal(WIDGET_BRIDGE_CHANNEL),
  widgetId: z.string().min(1),
  type: z.literal("open_link"),
  url: z.string().min(1),
});

const WidgetErrorMessageSchema = z.object({
  channel: z.literal(WIDGET_BRIDGE_CHANNEL),
  widgetId: z.string().min(1),
  type: z.literal("error"),
  message: z.string(),
});

export const WidgetGuestMessageSchema = z.discriminatedUnion("type", [
  WidgetHeightMessageSchema,
  WidgetPromptMessageSchema,
  WidgetOpenLinkMessageSchema,
  WidgetErrorMessageSchema,
]);

export type WidgetGuestMessage = z.infer<typeof WidgetGuestMessageSchema>;

/**
 * Parse a raw guest frame. Accepts the JSON string the native and Electron
 * transports deliver as well as an already-structured object (web's
 * MessageChannel). Returns null for anything unrecognized - including frames
 * for a different widget, which the caller filters by id.
 */
export function parseWidgetGuestMessage(raw: unknown): WidgetGuestMessage | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    // A widget's own console noise and any unrelated postMessage traffic land
    // here too; non-JSON is simply not ours.
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const parsed = WidgetGuestMessageSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Clamp a self-reported height into something a chat row can hold. */
export function clampWidgetHeight(px: number): number {
  if (!Number.isFinite(px)) {
    return WIDGET_MIN_HEIGHT_PX;
  }
  return Math.min(WIDGET_MAX_HEIGHT_PX, Math.max(WIDGET_MIN_HEIGHT_PX, Math.ceil(px)));
}
