import { session, type WebContents, type WebPreferences } from "electron";
import log from "electron-log/main";

// Must match VISUALIZER_WEBVIEW_PARTITION in
// packages/app/src/visualizer/visualizer-view.electron.tsx.
// Non-persist: the session is gone as soon as the app quits.
export const VISUALIZER_WEBVIEW_PARTITION = "otto-visualizer";

/**
 * The Visualizer bundle is our own build artifact, loaded as a data: URL into
 * a <webview> guest on its own session/partition so its inline scripts can
 * run without inheriting the app shell's CSP (same rationale as the artifact
 * webview). This guest gets no capability the browser-tab webviews have: no
 * navigation, no window opening, no OS permissions, no node integration.
 */
export function isVisualizerWebviewAttach(input: { src?: string; partition?: string }): boolean {
  return (
    input.partition === VISUALIZER_WEBVIEW_PARTITION && !!input.src?.startsWith("data:text/html")
  );
}

export function hardenVisualizerWebviewPreferences(webPreferences: WebPreferences): void {
  webPreferences.nodeIntegration = false;
  webPreferences.nodeIntegrationInSubFrames = false;
  webPreferences.nodeIntegrationInWorker = false;
  webPreferences.contextIsolation = true;
  webPreferences.sandbox = true;
  webPreferences.webSecurity = true;
  webPreferences.webviewTag = false;
  webPreferences.allowRunningInsecureContent = false;
  delete webPreferences.preload;
  delete (webPreferences as { preloadURL?: string }).preloadURL;
}

/** Deny every permission request (camera, mic, geolocation, clipboard, USB, etc.)
 * on the visualizer partition. Idempotent - safe to call on every attach. */
export function registerVisualizerWebviewSessionGuards(): void {
  const visualizerSession = session.fromPartition(VISUALIZER_WEBVIEW_PARTITION);
  visualizerSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  visualizerSession.setPermissionCheckHandler(() => false);
}

// How long a healthy guest can plausibly take to reach dom-ready. The bundle
// is a local data: URL (no network), so anything past this is a genuine
// startup failure, not slowness.
const GUEST_DOM_READY_WATCHDOG_MS = 20_000;

/**
 * Always-on failure diagnostics for the visualizer guest. The renderer-side
 * view dev-gates its logging and the guest has no visible console of its own,
 * so without this a guest that never loads — seen on Linux machines running
 * the GPU software-rendering fallback — fails with zero evidence anywhere.
 * These lines land in the electron-log file users can send.
 */
export function registerVisualizerWebviewDiagnostics(contents: WebContents): void {
  const id = contents.id;
  log.info("[visualizer-webview] guest attached", { webContentsId: id });

  let domReady = false;
  contents.once("dom-ready", () => {
    domReady = true;
    log.info("[visualizer-webview] guest dom-ready", { webContentsId: id });
  });
  const watchdog = setTimeout(() => {
    if (!domReady && !contents.isDestroyed()) {
      log.error(
        "[visualizer-webview] guest never reached dom-ready — the Visualizer tab will stay blank",
        { webContentsId: id, timeoutMs: GUEST_DOM_READY_WATCHDOG_MS },
      );
    }
  }, GUEST_DOM_READY_WATCHDOG_MS);
  contents.once("destroyed", () => clearTimeout(watchdog));

  contents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      // -3 (ERR_ABORTED) fires on normal teardown/reload.
      if (!isMainFrame || errorCode === -3) {
        return;
      }
      log.error("[visualizer-webview] guest failed to load", {
        webContentsId: id,
        errorCode,
        errorDescription,
      });
    },
  );
  contents.on("render-process-gone", (_event, details) => {
    log.error("[visualizer-webview] guest renderer gone", { webContentsId: id, ...details });
  });
  contents.on("unresponsive", () => {
    log.warn("[visualizer-webview] guest unresponsive", { webContentsId: id });
  });
}

/** The visualizer is a single self-contained document - it never legitimately
 * navigates away from its own data: URL or opens new windows/tabs. */
export function lockDownVisualizerWebviewContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  const denyNavigation = (event: { preventDefault: () => void }) => {
    event.preventDefault();
  };
  contents.on("will-navigate", denyNavigation);
  contents.on("will-frame-navigate", denyNavigation);
  contents.on("will-redirect", denyNavigation);
}
