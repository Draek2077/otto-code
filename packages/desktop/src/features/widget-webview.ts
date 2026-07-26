import { existsSync } from "node:fs";
import path from "node:path";
import log from "electron-log/main";
import { session, type WebContents, type WebPreferences } from "electron";

// Must match WIDGET_WEBVIEW_PARTITION in
// packages/app/src/widgets/widget-frame.electron.tsx. Non-persist: the session
// (and anything a widget's script writes to storage) is gone when the app
// quits.
export const WIDGET_WEBVIEW_PARTITION = "otto-widget-preview";

/**
 * Widgets are LLM-generated HTML fragments loaded as a data: URL into a
 * <webview> guest on its own session, so they can run inline scripts without
 * inheriting the app shell's CSP.
 *
 * They differ from artifact guests in exactly one capability: a preload. A
 * widget's height is content-driven, and the only way a host can size a frame
 * to content it cannot measure is for the guest to report it — which needs a
 * channel. `sendPrompt`/`openLink` ride the same one. Everything else is locked
 * down identically: no node, no navigation, no window opening, no permissions.
 */
export function isWidgetWebviewAttach(input: { src?: string; partition?: string }): boolean {
  return input.partition === WIDGET_WEBVIEW_PARTITION && !!input.src?.startsWith("data:text/html");
}

/**
 * Resolve the widget preload from the main bundle's root directory.
 *
 * The `..` is load-bearing. This module compiles to `dist/features/`, one level
 * BELOW the bundle root where `src/widget-preload.ts` is emitted as
 * `dist/widget-preload.js`. Joining against `__dirname` alone points at a file
 * that does not exist — and Electron ignores a missing preload SILENTLY: the
 * guest still loads, still runs its own scripts, still renders. The only
 * symptom is a widget frozen at the host's initial height forever, because
 * `__ottoWidgetHost` is undefined and its measured height has nowhere to go.
 *
 * The path is computed here and never taken from the renderer. A renderer-
 * supplied `preload`/`preloadURL` is deleted by the caller before this runs, so
 * a compromised renderer cannot point a guest at arbitrary code — the main
 * process decides what, if anything, gets injected.
 */
export function getWidgetPreloadPath(): string {
  return path.join(__dirname, "..", "widget-preload.js");
}

/** Log the missing-preload case once rather than on every widget attach. */
let hasWarnedAboutMissingPreload = false;

export function hardenWidgetWebviewPreferences(webPreferences: WebPreferences): void {
  webPreferences.nodeIntegration = false;
  webPreferences.nodeIntegrationInSubFrames = false;
  webPreferences.nodeIntegrationInWorker = false;
  webPreferences.contextIsolation = true;
  webPreferences.sandbox = true;
  webPreferences.webSecurity = true;
  webPreferences.webviewTag = false;
  webPreferences.allowRunningInsecureContent = false;
  delete (webPreferences as { preloadURL?: string }).preloadURL;
  const preloadPath = getWidgetPreloadPath();
  // Electron drops a missing preload without a word, and the widget that
  // results looks like a rendering bug rather than a packaging one. Say it out
  // loud in the log users can send.
  if (!hasWarnedAboutMissingPreload && !existsSync(preloadPath)) {
    hasWarnedAboutMissingPreload = true;
    log.error(
      `[widget] preload missing at ${preloadPath} — widgets cannot report their height and will stay at the host's initial size`,
    );
  }
  webPreferences.preload = preloadPath;
}

/** Deny every permission request (camera, mic, geolocation, clipboard, USB, …)
 * on the widget partition. Idempotent — safe to call on every attach. */
export function registerWidgetWebviewSessionGuards(): void {
  const widgetSession = session.fromPartition(WIDGET_WEBVIEW_PARTITION);
  widgetSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  widgetSession.setPermissionCheckHandler(() => false);
}

/** A widget renders one fragment and never navigates or opens a window. Links
 * are intercepted inside the guest and routed to the host as `open_link`
 * messages, which go through Otto's own confirmation path. */
export function lockDownWidgetWebviewContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  const denyNavigation = (event: { preventDefault: () => void }) => {
    event.preventDefault();
  };
  contents.on("will-navigate", denyNavigation);
  contents.on("will-frame-navigate", denyNavigation);
  contents.on("will-redirect", denyNavigation);
}
