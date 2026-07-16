import { session, type WebContents, type WebPreferences } from "electron";

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
