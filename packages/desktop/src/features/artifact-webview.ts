import { session, type WebContents, type WebPreferences } from "electron";

// Must match ARTIFACT_WEBVIEW_PARTITION in
// packages/app/src/components/artifacts/artifact-html-view.electron.tsx.
// Non-persist: the session (and any storage an artifact's script writes) is
// gone as soon as the app quits.
export const ARTIFACT_WEBVIEW_PARTITION = "otto-artifact-preview";

/**
 * Artifacts are LLM-generated HTML, loaded as a data: URL into a <webview>
 * guest on its own session/partition so they can run their own inline
 * scripts without inheriting the app shell's CSP. That means this guest gets
 * no capability the browser-tab webviews have: no navigation, no window
 * opening, no OS permissions, no node integration. It only renders the
 * document it was given.
 */
export function isArtifactWebviewAttach(input: { src?: string; partition?: string }): boolean {
  return (
    input.partition === ARTIFACT_WEBVIEW_PARTITION && !!input.src?.startsWith("data:text/html")
  );
}

export function hardenArtifactWebviewPreferences(webPreferences: WebPreferences): void {
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
 * on the artifact partition. Idempotent - safe to call on every attach. */
export function registerArtifactWebviewSessionGuards(): void {
  const artifactSession = session.fromPartition(ARTIFACT_WEBVIEW_PARTITION);
  artifactSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  artifactSession.setPermissionCheckHandler(() => false);
}

/** An artifact is a single self-contained document - it never legitimately
 * navigates away from its own data: URL or opens new windows/tabs. */
export function lockDownArtifactWebviewContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  const denyNavigation = (event: { preventDefault: () => void }) => {
    event.preventDefault();
  };
  contents.on("will-navigate", denyNavigation);
  contents.on("will-frame-navigate", denyNavigation);
  contents.on("will-redirect", denyNavigation);
}
