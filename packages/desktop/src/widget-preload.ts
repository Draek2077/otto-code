import { contextBridge, ipcRenderer } from "electron";

/**
 * Preload for widget <webview> guests.
 *
 * Widgets are the one guest type that legitimately needs to talk back: they
 * report their own content height (there is no other way for the host to size a
 * content-driven frame) and they carry the `sendPrompt`/`openLink` globals.
 * Artifact guests get their preload stripped in main.ts precisely because they
 * need none of that; widgets get this one instead.
 *
 * It exposes exactly one function, one-way, and nothing else — no ipcRenderer,
 * no `require`, no Node. contextIsolation is on, so this code runs in the
 * isolated world and the bridge is the ONLY thing the fragment's own scripts
 * can see. The host still parses and validates every frame
 * (protocol/widgets/bridge.ts) and treats the payload as untrusted; this file
 * only moves bytes.
 */

const WIDGET_IPC_CHANNEL = "otto-widget";

/** A hard ceiling so a runaway guest cannot flood the host renderer. */
const MAX_FRAME_CHARS = 8_000;

contextBridge.exposeInMainWorld("__ottoWidgetHost", {
  post(text: unknown): void {
    if (typeof text !== "string" || text.length === 0 || text.length > MAX_FRAME_CHARS) {
      return;
    }
    ipcRenderer.sendToHost(WIDGET_IPC_CHANNEL, text);
  },
});
