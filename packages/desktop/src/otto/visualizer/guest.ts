import type { WebPreferences, WebContents, Session } from "electron";

export const VISUALIZER_PARTITION = "otto-visualizer";
export function visualizerAllowsRequest(url: string) {
  return url.startsWith("data:") || url === "about:blank";
}
export function isVisualizerAttach(input: { partition?: string; src?: string }) {
  return (
    input.partition === VISUALIZER_PARTITION &&
    Boolean(input.src?.startsWith("data:text/html;charset=utf-8,")) &&
    (input.src?.length ?? 0) < 4_000_000
  );
}
export function hardenVisualizerPreferences(
  preferences: WebPreferences,
  params: { preload?: string },
) {
  preferences.nodeIntegration = false;
  preferences.nodeIntegrationInSubFrames = false;
  preferences.nodeIntegrationInWorker = false;
  preferences.contextIsolation = true;
  preferences.sandbox = true;
  preferences.webSecurity = true;
  preferences.webviewTag = false;
  preferences.allowRunningInsecureContent = false;
  preferences.backgroundThrottling = true;
  delete preferences.preload;
  delete params.preload;
}
export function hardenVisualizerSession(profile: Session) {
  profile.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  profile.setPermissionCheckHandler(() => false);
  profile.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !visualizerAllowsRequest(details.url) }),
  );
}
export function hardenVisualizerContents(contents: WebContents) {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  const deny = (event: { preventDefault(): void }) => event.preventDefault();
  contents.on("will-navigate", deny);
  contents.on("will-frame-navigate", deny);
  contents.on("will-redirect", deny);
  contents.on("will-attach-webview", deny);
}
