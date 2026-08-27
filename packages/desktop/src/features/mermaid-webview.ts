import { session, type WebContents, type WebPreferences } from "electron";
import log from "electron-log/main";

// Must match MERMAID_WEBVIEW_PARTITION in
// packages/app/src/components/markdown/fence/mermaid/host.web.tsx.
// Non-persist: the session is gone as soon as the app quits.
export const MERMAID_WEBVIEW_PARTITION = "otto-mermaid-runtime";

/**
 * Mermaid's self-contained runtime is loaded as a data: URL into a <webview>
 * guest on its own session so its inline script does not inherit the app
 * shell's strict CSP. It only renders trusted application-generated runtime
 * HTML: no Node integration, navigation, windows, or OS permissions.
 */
export function isMermaidWebviewAttach(input: { src?: string; partition?: string }): boolean {
  return input.partition === MERMAID_WEBVIEW_PARTITION && !!input.src?.startsWith("data:text/html");
}

export function hardenMermaidWebviewPreferences(webPreferences: WebPreferences): void {
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

/** Deny every permission request on the Mermaid runtime partition.
 * Idempotent: safe to call for every guest attach. */
export function registerMermaidWebviewSessionGuards(): void {
  const mermaidSession = session.fromPartition(MERMAID_WEBVIEW_PARTITION);
  mermaidSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  mermaidSession.setPermissionCheckHandler(() => false);
}

/**
 * Mermaid keeps the highlighted source visible until the guest reports a
 * successful render. Without these diagnostics, a guest-load failure looks
 * exactly like ordinary malformed diagram source to the user.
 */
export function registerMermaidWebviewDiagnostics(contents: WebContents): void {
  const id = contents.id;
  let domReady = false;
  contents.once("dom-ready", () => {
    domReady = true;
  });
  const watchdog = setTimeout(() => {
    if (!domReady && !contents.isDestroyed()) {
      log.error("[mermaid-webview] guest never reached dom-ready", {
        webContentsId: id,
      });
    }
  }, 20_000);
  contents.once("destroyed", () => clearTimeout(watchdog));
  contents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      // -3 (ERR_ABORTED) fires during ordinary teardown and reload.
      if (!isMainFrame || errorCode === -3) {
        return;
      }
      log.error("[mermaid-webview] guest failed to load", {
        webContentsId: id,
        errorCode,
        errorDescription,
      });
    },
  );
  contents.on("render-process-gone", (_event, details) => {
    log.error("[mermaid-webview] guest renderer gone", { webContentsId: id, ...details });
  });
}

/** The Mermaid runtime is one self-contained document and must never navigate
 * away or open a window. */
export function lockDownMermaidWebviewContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  const denyNavigation = (event: { preventDefault: () => void }) => {
    event.preventDefault();
  };
  contents.on("will-navigate", denyNavigation);
  contents.on("will-frame-navigate", denyNavigation);
  contents.on("will-redirect", denyNavigation);
}
