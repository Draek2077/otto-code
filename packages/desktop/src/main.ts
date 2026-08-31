process.emitWarning = (() => {}) as typeof process.emitWarning;

import log from "electron-log/main";
log.transports.console.level = "info";
log.initialize({ spyRendererConsole: true });

import { inheritLoginShellEnv } from "./login-shell-env.js";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  app,
  autoUpdater as electronAutoUpdater,
  BrowserWindow,
  clipboard,
  Menu,
  ipcMain,
  nativeImage,
  net,
  protocol,
  screen,
  session,
  shell,
  webContents,
} from "electron";
import {
  clearOttoBrowserProfile,
  getLegacyOttoBrowserProfileSession,
  getOttoBrowserProfileSession,
  getOttoBrowserProfileSessions,
  listOttoBrowserProfileGuests,
  OTTO_BROWSER_PROFILE_PARTITION,
  readLegacyOttoBrowserIds,
} from "./features/browser-profile.js";
import { createDaemonCommandHandlers, registerDaemonManager } from "./daemon/daemon-manager.js";
import { parsePassthroughCliArgsFromArgv, runPassthroughCli } from "./daemon/cli/passthrough.js";
import { closeAllTransportSessions } from "./daemon/local-transport.js";
import {
  applyDesktopWindowChromeMode,
  registerWindowManager,
  registerPendingWindowReveal,
  clearPendingWindowReveal,
  getMainWindowChromeOptions,
  getWindowBackgroundColor,
  resolveSystemWindowTheme,
  resolveWindowBounds,
  setupWindowResizeEvents,
  setupWindowStatePersistence,
  setupDragDropPrevention,
  setupCursorHoverForwarding,
  buildStandardContextMenuItems,
} from "./window/window-manager.js";
import { setupDarwinCompositorWatchdog } from "./window/compositor-watchdog/index.js";
import {
  buildDevShortcutDetails,
  decideAppUserModelId,
  resolveDevShortcutPath,
} from "./features/app-user-model-id.js";
import { resolveBrandedAssetPath } from "./features/dev-icon.js";
import { registerDialogHandlers } from "./features/dialogs.js";
import { registerPrintToPdfHandlers } from "./features/print-to-pdf.js";
import {
  registerNotificationHandlers,
  ensureNotificationCenterRegistration,
} from "./features/notifications.js";
import { registerOpenerHandlers } from "./features/opener.js";
import { registerEditorTargetHandlers } from "./features/editor-targets/ipc.js";
import { resolveDesktopWindowChromeMode, windowChromeModeArgument } from "./window/chrome.js";
import { resolveAppIconPath } from "./features/stamped-icon.js";
import { setupApplicationMenu } from "./features/menu.js";
import {
  BROWSER_NEW_TAB_REQUEST_EVENT,
  decideBrowserWindowOpenRequest,
  getOttoBrowserIdForWebContents,
  getOttoBrowserWebContentsForHostWindow,
  getOttoBrowserWebviewRegistry,
  isOttoBrowserWebviewAttach,
  listRegisteredOttoBrowserIds,
  PendingBrowserWindowOpenRequests,
  prepareOttoBrowserWebContents,
  registerAttachedOttoBrowser,
  registerBrowserWebviewNavigationGuards,
  unregisterOttoBrowserFromHost,
  unregisterOttoBrowserHost,
  setWorkspaceActiveOttoBrowserId,
} from "./features/browser-webviews/index.js";
import {
  hardenArtifactWebviewPreferences,
  isArtifactWebviewAttach,
  lockDownArtifactWebviewContents,
  registerArtifactWebviewSessionGuards,
} from "./features/artifact-webview.js";
import {
  hardenMermaidWebviewPreferences,
  isMermaidWebviewAttach,
  lockDownMermaidWebviewContents,
  registerMermaidWebviewDiagnostics,
  registerMermaidWebviewSessionGuards,
} from "./features/mermaid-webview.js";
import {
  hardenWidgetWebviewPreferences,
  isWidgetWebviewAttach,
  lockDownWidgetWebviewContents,
  registerWidgetWebviewSessionGuards,
} from "./features/widget-webview.js";
import {
  hardenVisualizerWebviewPreferences,
  isVisualizerWebviewAttach,
  lockDownVisualizerWebviewContents,
  registerVisualizerWebviewDiagnostics,
  registerVisualizerWebviewSessionGuards,
} from "./features/visualizer-webview.js";
import {
  parseOpenProjectPathFromArgv,
  parseOpenTargetFromArgv,
  type OpenTarget,
} from "./open-project-routing.js";
import {
  buildAgentDeepLinkRoute,
  parseAgentDeepLink,
  type AgentDeepLinkTarget,
} from "@otto-code/protocol/agent-deep-link";
import { AgentNavigationInbox, parseAgentDeepLinkFromArgv } from "./agent-navigation.js";
import { PendingOpenProjectStore } from "./pending-open-project-store.js";
import { getDesktopSettingsStore } from "./settings/desktop-settings-electron.js";
import { clampWindowStateToWorkAreas, createWindowStateStore } from "./settings/window-state.js";
import {
  isDesktopManagedDaemonRunningSync,
  stopDesktopDaemonViaCli,
} from "./daemon/daemon-manager.js";
import {
  createQuitLifecycle,
  shouldStopDesktopManagedDaemonOnQuit,
  registerExternalQuitSignals,
  stopDesktopManagedDaemonOnQuitIfNeeded,
  markAppQuitting,
  isAppQuitting,
} from "./daemon/quit-lifecycle.js";
import { installAppUpdateOnQuit } from "./features/auto-updater.js";
import {
  requestQuitConfirmation,
  markQuitPreConfirmed,
  consumeQuitPreConfirmation,
} from "./daemon/quit-confirm.js";
import { runDesktopStartup } from "./desktop-startup.js";
import {
  applyPersistedHardwareAccelerationFallback,
  armGpuStartupPaintWatchdog,
  armGpuStartupSentinel,
  isGpuRecoveryInProgress,
  markGpuStartupHealthy,
  registerGpuFallbackRecovery,
} from "./gpu-fallback.js";
import { registerCrashDialog, showStartupErrorDialog } from "./crash-dialog.js";
import { registerBrowserAutomationIpc } from "./features/browser-automation/ipc.js";
import { BrowserKeyboard } from "./features/browser-keyboard/index.js";
import { createTrustedOttoOriginPolicy, isTrustedMainWindowSender } from "./trusted-main-window.js";
import { registerWakeWordHandlers } from "./features/wake-word.js";
import {
  registerZoomRecorderHandlers,
  shutdownZoomRecorderForQuit,
} from "./features/zoom-recorder.js";
import {
  getCachedMinimizeOnCloseSetting,
  getCachedTrayIconSetting,
  refreshTrayVisibility,
  setCachedMinimizeOnCloseSetting,
  setCachedTrayIconSetting,
  shouldHideWindowOnClose,
  type TrayLifecycleOptions,
} from "./features/tray.js";

const DEV_SERVER_URL = process.env.EXPO_DEV_URL ?? "http://localhost:8081";
const APP_SCHEME = "otto";
const DESKTOP_WINDOW_CHROME_MODE = resolveDesktopWindowChromeMode({
  platform: process.platform,
  override: process.env.OTTO_DESKTOP_WINDOW_CONTROLS,
  isPackaged: app.isPackaged,
});
const trustedOttoOriginPolicy = createTrustedOttoOriginPolicy({
  packaged: app.isPackaged,
  developmentUrls: [DEV_SERVER_URL],
});

function requireTrustedMainRenderer(event: Electron.IpcMainInvokeEvent): void {
  if (!isTrustedMainWindowSender(event.sender, trustedOttoOriginPolicy)) {
    throw new Error("Rejected IPC from an untrusted renderer.");
  }
}
const OTTO_DEBUG = process.env.OTTO_DEBUG === "1";
const DISABLE_SINGLE_INSTANCE_LOCK = process.env.OTTO_DISABLE_SINGLE_INSTANCE_LOCK === "1";
// A guest can ask to open a new tab before it has registered its browserId.
// Hold those URLs until registration completes, then replay them.
const pendingBrowserWindowOpenRequests = new PendingBrowserWindowOpenRequests();
const APP_NAME = process.env.OTTO_TEST_APP_NAME?.trim() || "Otto";
// How long a quit waits for the update revalidation, and then for the installer
// to take over the quit, before exiting hard anyway.
const UPDATE_QUIT_DEADLINE_MS = 5_000;

const DESKTOP_SMOKE_ENV = "OTTO_DESKTOP_SMOKE";
const DESKTOP_SMOKE_STOP_REQUEST = "otto-smoke-stop";
app.setName(APP_NAME);

// Windows identifies notification senders and routes toast clicks by
// AppUserModelID, not app.getName(). Without one, Windows falls back to
// Electron's own default identity, so toasts are labeled "Electron" and
// clicking one launches a bare electron.exe instead of activating us.
//
// The packaged app must use electron-builder's `appId` - the NSIS installer
// stamps that same AUMID onto its Start Menu shortcut, and Windows resolves the
// sender through it. A dev build has no such shortcut, so it writes its own and
// claims a distinct AUMID; that is what keeps dev toasts attributable when both
// apps are running. See features/app-user-model-id.ts for the fallback rule.
function applyAppUserModelId(): void {
  const decision = decideAppUserModelId({
    platform: process.platform,
    isPackaged: app.isPackaged,
    skipDevShortcut: process.env.OTTO_SKIP_DEV_SHORTCUT === "1",
    writeDevShortcut: () => {
      try {
        return shell.writeShortcutLink(
          resolveDevShortcutPath(app.getPath("appData")),
          "create",
          buildDevShortcutDetails({
            execPath: process.execPath,
            appPath: app.getAppPath(),
            iconPath: getWindowIconPath(),
          }),
        );
      } catch (error) {
        log.warn("[aumid] failed to write the dev Start Menu shortcut", error);
        return false;
      }
    },
  });

  if (!decision.appUserModelId) {
    return;
  }

  app.setAppUserModelId(decision.appUserModelId);
  if (!app.isPackaged && process.platform === "win32") {
    log.info(
      `[aumid] using ${decision.appUserModelId}` +
        (decision.wroteDevShortcut
          ? " (dev Start Menu shortcut written)"
          : " - no dev shortcut, dev toasts will look like the installed app's"),
    );
  }
}

applyAppUserModelId();

// CSP for the app shell's own session only (registered on defaultSession, which
// the main window uses). Browser-webview guests run on separate
// `persist:otto-browser-*` partitions and are untouched by this policy - they
// browse arbitrary third-party sites, so imposing our own CSP there would be
// both wrong (it's not our content) and easily broken by real-world pages.
//
// connect-src stays wide open (any http/https/ws/wss origin): Otto's core
// multi-host feature lets users point the renderer at arbitrary daemon hosts
// (LAN, Tailscale, the relay), so a fixed allowlist would break that. The
// actual security value here is script-src/object-src/base-uri - blocking
// injected/inline script execution and foreign navigation targets.
const CSP_SHARED_DIRECTIVES = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "connect-src 'self' http: https: ws: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
];

// Dev loads the Expo/Metro dev server, whose Fast Refresh relies on eval'd
// source maps. The packaged app loads static otto:// assets and doesn't need it.
const DEV_CONTENT_SECURITY_POLICY = [
  // blob: allows the mic-capture AudioWorklet module to load from a Blob URL.
  // Chromium governs worklet modules via script-src (not worker-src/worklet-src).
  "script-src 'self' 'unsafe-eval' blob:",
  ...CSP_SHARED_DIRECTIVES,
].join("; ");
// blob: is required in prod script-src as well: the mic-capture AudioWorklet
// loads from a Blob URL, and Chromium governs worklet modules via script-src.
const PROD_CONTENT_SECURITY_POLICY = ["script-src 'self' blob:", ...CSP_SHARED_DIRECTIVES].join(
  "; ",
);

function registerAppShellContentSecurityPolicy(): void {
  const csp = app.isPackaged ? PROD_CONTENT_SECURITY_POLICY : DEV_CONTENT_SECURITY_POLICY;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers: Record<string, string[]> = { ...details.responseHeaders };
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "content-security-policy") {
        delete headers[key];
      }
    }
    headers["Content-Security-Policy"] = [csp];
    callback({ responseHeaders: headers });
  });
}

function getBrowserPopupWindowOptions(
  mainWindow: BrowserWindow,
): Electron.BrowserWindowConstructorOptions {
  return {
    parent: mainWindow,
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      partition: OTTO_BROWSER_PROFILE_PARTITION,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
    },
  };
}

function readAttachedBrowserInput(
  input: unknown,
): { browserId: string; workspaceId: string; webContentsId: number } | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  const record = input as Record<string, unknown>;
  if (typeof record.browserId !== "string" || record.browserId.trim().length === 0) {
    return null;
  }
  if (typeof record.workspaceId !== "string" || record.workspaceId.trim().length === 0) {
    return null;
  }
  if (
    typeof record.webContentsId !== "number" ||
    !Number.isInteger(record.webContentsId) ||
    record.webContentsId <= 0
  ) {
    return null;
  }
  return {
    browserId: record.browserId.trim(),
    workspaceId: record.workspaceId.trim(),
    webContentsId: record.webContentsId,
  };
}

function readActiveBrowserInput(
  input: unknown,
): { workspaceId: string; browserId: string | null } | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  const record = input as Record<string, unknown>;
  if (typeof record.workspaceId !== "string" || record.workspaceId.trim().length === 0) {
    return null;
  }
  const browserId = typeof record.browserId === "string" ? record.browserId.trim() : null;
  return { workspaceId: record.workspaceId.trim(), browserId: browserId || null };
}

type PendingWebviewAttach =
  | { kind: "browser" }
  | { kind: "artifact" }
  | { kind: "mermaid" }
  | { kind: "widget" }
  | { kind: "visualizer" };
const pendingWebviewAttaches: PendingWebviewAttach[] = [];

// Owns every key a browser guest sees: it gives the page first refusal on
// ordinary shortcuts, keeps guest keystrokes from reaching the composer, and
// forwards only the chords the renderer published as host-owned. The renderer
// publishes that policy over "otto:browser:set-shortcut-policy" on mount, so
// this must be constructed at module scope, before the first window loads.
const browserKeyboard = new BrowserKeyboard(getOttoBrowserWebviewRegistry());
browserKeyboard.registerIpc();

function showBrowserWebviewContextMenu(
  win: BrowserWindow,
  contents: Electron.WebContents,
  params: Electron.ContextMenuParams,
): void {
  const menu = Menu.buildFromTemplate([
    ...buildStandardContextMenuItems(contents, params),
    ...(app.isPackaged
      ? []
      : [
          { type: "separator" as const },
          {
            label: "Inspect Element",
            click: () => {
              log.info("[browser-devtools] inspect-element.request", {
                webContentsId: contents.id,
                browserId: getOttoBrowserIdForWebContents(contents),
                x: params.x,
                y: params.y,
                isDevToolsOpened: contents.isDevToolsOpened(),
              });
              contents.openDevTools({ mode: "detach" });
              contents.inspectElement(params.x, params.y);
              log.info("[browser-devtools] inspect-element.done", {
                webContentsId: contents.id,
                isDevToolsOpened: contents.isDevToolsOpened(),
              });
            },
          },
        ]),
  ]);
  menu.popup({ window: win });
}

// In dev mode, detect git worktrees and isolate each instance so multiple
// Electron windows can run side-by-side (separate userData = separate lock).
let devWorktreeName: string | null = null;
const forcedUserDataDir = process.env.OTTO_ELECTRON_USER_DATA_DIR?.trim();
if (forcedUserDataDir) {
  app.setPath("userData", forcedUserDataDir);
  log.info("[dev-user-data] forced userData dir:", forcedUserDataDir);
} else if (!app.isPackaged) {
  try {
    const topLevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      timeout: 3000,
      windowsHide: true,
    }).trim();
    devWorktreeName = path.basename(topLevel);
    // Main checkout (e.g. "otto") gets default userData - only worktrees diverge.
    const commonDir = path.resolve(
      topLevel,
      execFileSync("git", ["rev-parse", "--git-common-dir"], {
        cwd: topLevel,
        encoding: "utf-8",
        timeout: 3000,
        windowsHide: true,
      }).trim(),
    );
    const isWorktree = path.resolve(topLevel, ".git") !== commonDir;
    if (isWorktree) {
      app.setPath("userData", path.join(app.getPath("appData"), `Otto-${devWorktreeName}`));
      log.info("[worktree] isolated userData for worktree:", devWorktreeName);
    } else {
      devWorktreeName = null;
    }
  } catch {
    devWorktreeName = null;
  }
}

// AppImage runtimes mount the app from /tmp under the user's UID, so the SUID
// chrome-sandbox helper we ship in .deb/.rpm cannot work there. Disable the
// sandbox only in that case; .deb/.rpm keep the sandbox on, matching VS Code.
if (process.platform === "linux" && process.env.APPIMAGE) {
  app.commandLine.appendSwitch("no-sandbox");
}

// Allow users to pass Chromium flags via OTTO_ELECTRON_FLAGS for debugging
// rendering issues (e.g. "--disable-gpu --ozone-platform=x11").
// Must run before app.whenReady().
const electronFlags = process.env.OTTO_ELECTRON_FLAGS?.trim();
if (electronFlags) {
  for (const token of electronFlags.split(/\s+/)) {
    const [key, ...rest] = token.replace(/^--/, "").split("=");
    app.commandLine.appendSwitch(key, rest.join("=") || undefined);
  }
  log.info("[electron-flags]", electronFlags);
}

// Adds Chromium features without clobbering whatever is already on the command
// line - appendSwitch("enable-features", …) replaces the previous value, so an
// OTTO_ELECTRON_FLAGS-supplied list and ours have to be merged, not stacked.
function appendChromiumFeatures(features: readonly string[]): void {
  const existing = app.commandLine.getSwitchValue("enable-features");
  const merged = new Set(existing ? existing.split(",").filter(Boolean) : []);
  for (const feature of features) {
    merged.add(feature);
  }
  app.commandLine.appendSwitch("enable-features", [...merged].join(","));
}

// The Otto browser pane shows guest pages in a <webview>, and those pages draw
// Chromium's classic always-visible scrollbar - the one surface in the app that
// still does. Every scrollable surface in Otto's own renderer sets
// scrollbar-width: none and paints the themed auto-hiding overlay instead (see
// use-web-scrollbar / web-desktop-scrollbar), so the browser's content area was
// the odd one out.
//
// CSS is not an option for the fix: a styled ::-webkit-scrollbar still occupies
// layout width, which would distort the very page the preview subsystem asks
// agents to verify. Chromium's overlay scrollbars are the only mechanism that
// both floats over content and fades out when idle, and it is a process-wide
// switch rather than a per-webContents setting. Enabling it app-wide is
// effectively scoped to guest pages anyway - there is no native scrollbar left
// in Otto's own renderer for it to change. No-op on macOS, where overlay
// scrollbars are already the platform default.
//
// "OverlayScrollbar" is the feature that actually does this; measured on
// Chromium 146 (Electron 41) by loading an overflowing page and reading
// window.innerWidth - documentElement.clientWidth, it takes the scrollbar
// gutter from 15px to 0. The Fluent-era names ("FluentScrollbar",
// "FluentOverlayScrollbar") are no-ops in this build - Fluent styling is
// already the Windows default - so do not add them back as belt-and-braces:
// unknown features are silently ignored and would read as working config.
appendChromiumFeatures(["OverlayScrollbar"]);

// VM guests without 3D acceleration (VMware "No 3D enabled") and broken GPU
// drivers crash the GPU process and leave the window blank with no actionable
// error. Recover automatically: honor a persisted software-rendering marker up
// front (must happen before app.whenReady()), and register a listener that, on
// the first GPU failure, persists that marker and relaunches into software
// rendering. Both run before whenReady() so early GPU launch failures are caught.
applyPersistedHardwareAccelerationFallback();
registerGpuFallbackRecovery();

let pendingOpenProjectPath = parseOpenProjectPathFromArgv({
  argv: process.argv,
  isDefaultApp: process.defaultApp,
});
let pendingOpenTarget = parseOpenTargetFromArgv({
  argv: process.argv,
  isDefaultApp: process.defaultApp,
});

// Agent deep links (`otto://agent/...`). The OS hands them over either in argv
// (cold start, and Windows/Linux second-instance) or through 'open-url' (macOS).
// The inbox holds a target until the renderer says it is mounted, so a link that
// arrives during cold start is not delivered into a window that cannot route it.
const agentNavigationInbox = new AgentNavigationInbox();
let pendingAgentNavigation = parseAgentDeepLinkFromArgv(process.argv);

// Each window pulls its own pending open-project path on mount, keyed by
// webContents id, so deep-linked windows (second-instance launches, the
// in-app "Open in new window" action) land on the right project without
// racing a global.
const pendingOpenProjectStore = new PendingOpenProjectStore();

if (OTTO_DEBUG) {
  log.info("[open-project] argv:", process.argv);
  log.info("[open-project] isDefaultApp:", process.defaultApp);
  log.info("[open-project] pendingOpenProjectPath:", pendingOpenProjectPath);
}

// The renderer pulls the pending path on mount via IPC - this avoids
// a race where the push event arrives before React registers its listener.
ipcMain.handle("otto:get-pending-open-project", (event) => {
  requireTrustedMainRenderer(event);
  const webContentsId = event.sender.id;
  const result = pendingOpenProjectStore.take(webContentsId);
  // The pull happens on every window mount and is null in the common case -
  // only the deep-linked launch path is worth a log line.
  if (result !== null || OTTO_DEBUG) {
    log.info("[open-project] renderer requested pending path:", {
      webContentsId,
      pendingPath: result,
    });
  }
  return result;
});
ipcMain.handle("otto:get-pending-open-target", (event) => {
  requireTrustedMainRenderer(event);
  const webContentsId = event.sender.id;
  const result = pendingOpenProjectStore.takeTarget(webContentsId);
  if (result !== null || OTTO_DEBUG) {
    log.info("[open-target] renderer requested pending target:", { webContentsId, target: result });
  }
  return result;
});

// The renderer announces it can route, and collects any link that arrived while
// it was still mounting. preload.ts exposes this as the agent-navigation bridge.
ipcMain.handle("otto:agent-navigation:ready", (event) => {
  requireTrustedMainRenderer(event);
  return agentNavigationInbox.windowReady(event.sender.id);
});

function normalizeBrowserCaptureRect(
  rect: unknown,
): { x: number; y: number; width: number; height: number } | null {
  if (!rect || typeof rect !== "object") {
    return null;
  }
  const candidate = rect as Record<string, unknown>;
  const x = candidate.x;
  const y = candidate.y;
  const width = candidate.width;
  const height = candidate.height;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    width: Math.round(width),
    height: Math.round(height),
  };
}

ipcMain.handle("otto:browser:register-attached", (event, rawInput: unknown) => {
  requireTrustedMainRenderer(event);
  const input = readAttachedBrowserInput(rawInput);
  if (!input) {
    throw new Error("Invalid attached browser registration");
  }
  const registered = registerAttachedOttoBrowser({
    ...input,
    sender: event.sender,
    profileSession: getOttoBrowserProfileSession(session),
    findWebContents: (webContentsId) => webContents.fromId(webContentsId) ?? null,
  });
  if (!registered) {
    throw new Error("Attached browser registration was rejected");
  }
  const guest = webContents.fromId(input.webContentsId);
  if (!guest) {
    throw new Error("Attached browser guest disappeared after registration");
  }
  browserKeyboard.attach({ contents: guest, hostContents: event.sender });
  log.info("[browser-webview] registered", {
    browserId: input.browserId,
    webContentsId: input.webContentsId,
    registeredBrowserIds: listRegisteredOttoBrowserIds(),
  });
  for (const url of pendingBrowserWindowOpenRequests.take(input.webContentsId)) {
    event.sender.send(BROWSER_NEW_TAB_REQUEST_EVENT, {
      sourceBrowserId: input.browserId,
      url,
    });
  }
});

ipcMain.handle("otto:browser:unregister-workspace-browser", async (event, browserId: unknown) => {
  requireTrustedMainRenderer(event);
  if (typeof browserId !== "string" || browserId.trim().length === 0) {
    return;
  }
  const normalizedBrowserId = browserId.trim();
  // Scoped to the window that asked. The same browser can be open in another
  // window, and closing the tab here must not pull it out from under that one.
  const hasOtherHost = getOttoBrowserWebviewRegistry().hasBrowserInOtherHostWindow(
    event.sender.id,
    normalizedBrowserId,
  );
  unregisterOttoBrowserFromHost(event.sender.id, normalizedBrowserId);
  // COMPAT(browserProfile): added in v0.1.108; remove after 2027-01-15.
  // Tabs created before the shared partition still own a per-browser session;
  // reclaim it once the last window holding this browser lets go.
  const legacyProfile = hasOtherHost
    ? null
    : getLegacyOttoBrowserProfileSession(session, normalizedBrowserId);
  if (!legacyProfile) {
    return;
  }
  try {
    await clearOttoBrowserProfile({
      profileSessions: [legacyProfile],
      listGuests: () => [],
      logReloadError: () => {},
    });
  } catch (error) {
    log.warn("[browser-profile] failed to clear legacy tab profile", {
      browserId: normalizedBrowserId,
      error,
    });
  }
});

ipcMain.handle("otto:browser:set-workspace-active-browser", (event, rawInput: unknown) => {
  requireTrustedMainRenderer(event);
  const input = readActiveBrowserInput(rawInput);
  if (input) {
    setWorkspaceActiveOttoBrowserId({ ...input, hostWebContentsId: event.sender.id });
  }
});

ipcMain.handle("otto:browser:focus", (event, browserId: unknown): boolean => {
  if (typeof browserId !== "string" || browserId.trim().length === 0) {
    return false;
  }
  const contents = getOttoBrowserWebContentsForHostWindow(browserId, event.sender.id);
  if (!contents) {
    return false;
  }
  contents.focus();
  return true;
});

ipcMain.handle("otto:browser:open-devtools", (event, browserId: unknown) => {
  requireTrustedMainRenderer(event);
  if (typeof browserId !== "string" || browserId.trim().length === 0) {
    const result = {
      ok: false,
      reason: "invalid-browser-id",
      browserId,
      registeredBrowserIds: listRegisteredOttoBrowserIds(),
    };
    log.warn("[browser-devtools] open-devtools.invalid", result);
    return result;
  }
  const contents = getOttoBrowserWebContentsForHostWindow(browserId, event.sender.id);
  if (!contents) {
    const result = {
      ok: false,
      reason: "browser-webcontents-not-found",
      browserId,
      registeredBrowserIds: listRegisteredOttoBrowserIds(),
    };
    log.warn("[browser-devtools] open-devtools.not-found", result);
    return result;
  }
  log.info("[browser-devtools] open-devtools.request", {
    browserId,
    webContentsId: contents.id,
    isDestroyed: contents.isDestroyed(),
    isDevToolsOpened: contents.isDevToolsOpened(),
    registeredBrowserIds: listRegisteredOttoBrowserIds(),
  });
  contents.openDevTools({ mode: "detach" });
  const result = {
    ok: true,
    reason: "opened",
    browserId,
    webContentsId: contents.id,
    isDevToolsOpened: contents.isDevToolsOpened(),
  };
  log.info("[browser-devtools] open-devtools.done", result);
  return result;
});

// Settings -> Browser Data -> Clear. Wipes the shared browser partition plus
// every legacy per-browser partition the renderer still knows about, then
// reloads the live guests so they do not keep serving cleared state.
ipcMain.handle("otto:browser:clear-profile", async (event, rawLegacyBrowserIds: unknown) => {
  requireTrustedMainRenderer(event);
  const profileSessions = getOttoBrowserProfileSessions(
    session,
    readLegacyOttoBrowserIds(rawLegacyBrowserIds),
  );
  const profileSession = profileSessions[0];
  await clearOttoBrowserProfile({
    profileSessions,
    listGuests: () =>
      listOttoBrowserProfileGuests({
        profileSession,
        webContents: webContents.getAllWebContents(),
      }),
    logReloadError: (webContentsId, error) => {
      log.warn("[browser-profile] failed to reload guest", { webContentsId, error });
    },
  });
});

ipcMain.handle("otto:browser:capture-element", async (event, browserId: unknown, rect: unknown) => {
  requireTrustedMainRenderer(event);
  if (typeof browserId !== "string" || browserId.trim().length === 0) {
    return null;
  }
  const contents = getOttoBrowserWebContentsForHostWindow(browserId, event.sender.id);
  if (!contents || contents.isDestroyed()) {
    return null;
  }
  const captureRect = normalizeBrowserCaptureRect(rect);
  if (!captureRect) {
    return null;
  }
  try {
    // capturePage expects an integer rect in CSS pixels relative to the
    // guest viewport, which matches getBoundingClientRect() on the page.
    const image = await contents.capturePage(captureRect);
    if (image.isEmpty()) {
      return null;
    }
    return image.toDataURL();
  } catch (error) {
    log.warn("[browser-capture] capture-element.failed", {
      browserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
});

ipcMain.handle("otto:browser:copy-element", (event, payload: unknown): boolean => {
  requireTrustedMainRenderer(event);
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const { text, imageDataUrl } = payload as { text?: unknown; imageDataUrl?: unknown };
  const copyText = typeof text === "string" && text.length > 0 ? text : null;

  // Resolve the image first so we can write the clipboard exactly once and
  // avoid flashing an intermediate text-only state.
  let image: Electron.NativeImage | null = null;
  if (typeof imageDataUrl === "string" && imageDataUrl.startsWith("data:image")) {
    try {
      const candidate = nativeImage.createFromDataURL(imageDataUrl);
      if (!candidate.isEmpty()) {
        image = candidate;
      }
    } catch (error) {
      log.warn("[browser-capture] copy-element.image-failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Writing from the main process avoids the renderer's navigator.clipboard
  // NotAllowedError, which fires when focus is inside the guest <webview>.
  if (copyText && image) {
    clipboard.write({ text: copyText, image });
    return true;
  }
  if (image) {
    clipboard.writeImage(image);
    return true;
  }
  if (copyText) {
    clipboard.writeText(copyText);
    return true;
  }
  return false;
});

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

function getPreloadPath(): string {
  return path.join(__dirname, "preload.js");
}

function getBrowserKeyboardPreloadPath(): string {
  return path.join(__dirname, "features", "browser-keyboard", "guest-preload.js");
}

function getAppDistDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app-dist");
  }

  return path.resolve(__dirname, "../../app/dist");
}

function getWindowIconCandidates(): string[] {
  if (app.isPackaged) {
    if (process.platform === "win32") {
      return [
        path.join(process.resourcesPath, "icon.ico"),
        path.join(process.resourcesPath, "icon.png"),
      ];
    }
    return [path.join(process.resourcesPath, "icon.png")];
  }
  // Unpackaged: prefer the navy dev tile so the dev window and taskbar button
  // are distinguishable from the installed app's. See features/dev-icon.ts.
  const assetsDir = path.resolve(__dirname, "../assets");
  if (process.platform === "win32") {
    return [
      resolveBrandedAssetPath(assetsDir, "icon.ico"),
      resolveBrandedAssetPath(assetsDir, "icon.png"),
    ];
  }
  return [resolveBrandedAssetPath(assetsDir, "icon.png")];
}

function getWindowIconPath(): string | null {
  const candidates = getWindowIconCandidates();
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function showMostRecentWindowOrCreateOne(): void {
  const existing = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed());
  if (existing) {
    if (existing.isMinimized()) {
      existing.restore();
    }
    existing.show();
    existing.focus();
    return;
  }
  void createWindow({ restoreWindowState: true }).catch((error) => {
    log.error("[tray] failed to create window from tray", error);
  });
}

const TRAY_LIFECYCLE_OPTIONS: TrayLifecycleOptions = {
  isTrayIconEnabled: getCachedTrayIconSetting,
  onShowWindow: showMostRecentWindowOrCreateOne,
  onQuit: () => app.quit(),
};

// Only the first window of a session honors "start minimized to tray". A
// window opened later (⌘N, second-instance, "Open in new window") is an
// explicit ask to see it. macOS uses its dock for no-window recall, and a
// disabled tray icon must never leave a hidden window with no recall path.
async function shouldStartMinimizedToTrayForWindow(restoreWindowState: boolean): Promise<boolean> {
  if (!restoreWindowState || process.platform === "darwin") {
    return false;
  }
  const tray = (await getDesktopSettingsStore().get()).tray;
  return tray.showIcon && tray.startMinimized;
}

function getDevBuildLabel(): string | null {
  if (app.isPackaged) {
    return null;
  }
  return process.env.EXPO_PUBLIC_OTTO_DEV_BUILD_LABEL?.trim() || null;
}

let cachedEffectiveIconPath: string | null = null;

async function getEffectiveAppIconPath(): Promise<string | null> {
  if (cachedEffectiveIconPath !== null) {
    return cachedEffectiveIconPath;
  }
  const baseIconPath = getWindowIconPath();
  if (app.isPackaged || !baseIconPath) {
    cachedEffectiveIconPath = baseIconPath;
    return baseIconPath;
  }
  const devLabel = getDevBuildLabel();
  cachedEffectiveIconPath = await resolveAppIconPath({
    isPackaged: false,
    baseIconPath,
    devLabel,
    cacheDir: app.getPath("userData"),
  });
  return cachedEffectiveIconPath;
}

async function applyAppIcon(): Promise<void> {
  if (process.platform !== "darwin") {
    return;
  }

  const iconPath = await getEffectiveAppIconPath();
  if (!iconPath) {
    return;
  }

  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    return;
  }

  app.dock?.setIcon(icon);
}

// Work areas with the primary display first, so window-state clamping treats
// it as the fallback. getAllDisplays() order is not guaranteed to lead with it.
function getWorkAreasPrimaryFirst(): Electron.Rectangle[] {
  const primary = screen.getPrimaryDisplay();
  const others = screen.getAllDisplays().filter((display) => display.id !== primary.id);
  return [primary, ...others].map((display) => display.workArea);
}

async function createWindow(
  options: {
    pendingOpenProjectPath?: string | null;
    pendingOpenTarget?: OpenTarget | null;
    restoreWindowState?: boolean;
    /** Route to land on instead of "/" - an agent deep link that had no window to focus. */
    initialRoute?: string | null;
  } = {},
): Promise<BrowserWindow> {
  const iconPath = await getEffectiveAppIconPath();
  const systemTheme = resolveSystemWindowTheme();

  // Only the first window of a session restores and persists saved geometry.
  // Additional windows (⌘N, second-instance, "Open in new window") open at the
  // default size and let the OS cascade them, so they neither stack on top of
  // the restored window nor fight over the single window-state store.
  const restoreWindowState = options.restoreWindowState ?? false;
  const windowStateStore = restoreWindowState
    ? createWindowStateStore({ userDataPath: app.getPath("userData") })
    : null;
  const savedWindowState = windowStateStore ? await windowStateStore.load() : null;
  const restoredWindowState = savedWindowState
    ? clampWindowStateToWorkAreas(savedWindowState, getWorkAreasPrimaryFirst())
    : null;

  const shouldStartMinimizedToTray = await shouldStartMinimizedToTrayForWindow(restoreWindowState);

  const title = devWorktreeName ? `${APP_NAME} (${devWorktreeName})` : APP_NAME;
  const mainWindow = new BrowserWindow({
    title,
    ...resolveWindowBounds(restoredWindowState),
    show: false,
    backgroundColor: getWindowBackgroundColor(systemTheme),
    ...(iconPath ? { icon: iconPath } : {}),
    ...getMainWindowChromeOptions({
      platform: process.platform,
      theme: systemTheme,
      mode: DESKTOP_WINDOW_CHROME_MODE,
      restoredOverlay: restoredWindowState?.overlay ?? null,
    }),
    webPreferences: {
      preload: getPreloadPath(),
      additionalArguments: [windowChromeModeArgument(DESKTOP_WINDOW_CHROME_MODE)],
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });
  applyDesktopWindowChromeMode({ win: mainWindow, mode: DESKTOP_WINDOW_CHROME_MODE });

  const webContentsId = mainWindow.webContents.id;
  pendingOpenProjectStore.set(webContentsId, options.pendingOpenProjectPath);
  pendingOpenProjectStore.setTarget(webContentsId, options.pendingOpenTarget);
  // A full-document navigation tears down the renderer's listeners, so the
  // window stops being deliverable until it reports ready again.
  mainWindow.webContents.on("did-start-navigation", (_event, _url, isSameDocument, isMainFrame) => {
    if (isMainFrame && !isSameDocument) {
      agentNavigationInbox.windowLoading(webContentsId);
    }
  });
  mainWindow.on("closed", () => {
    pendingOpenProjectStore.delete(webContentsId);
    clearPendingWindowReveal(webContentsId);
    agentNavigationInbox.removeWindow(webContentsId);
    unregisterOttoBrowserHost(webContentsId);
    browserKeyboard.detachHost(webContentsId);
  });

  // Windows/Linux: hide the last visible window to the tray instead of letting it
  // close, unless the user opted out or an app quit is already in flight. macOS's
  // native close behavior is untouched - the dock already keeps Otto running with
  // zero windows open, which is this feature's mac equivalent.
  mainWindow.on("close", (event) => {
    const otherWindows = BrowserWindow.getAllWindows().filter(
      (win) => win !== mainWindow && !win.isDestroyed(),
    );
    const otherVisibleWindowCount = otherWindows.filter((win) => win.isVisible()).length;
    const shouldHide = shouldHideWindowOnClose({
      platform: process.platform,
      trayIconEnabled: getCachedTrayIconSetting(),
      minimizeOnCloseEnabled: getCachedMinimizeOnCloseSetting(),
      isQuitting: isAppQuitting(),
      otherVisibleWindowCount,
    });
    if (shouldHide) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }

    // Closing the last window on Windows/Linux triggers window-all-closed →
    // app.quit(), but by then this window is already destroyed - before-quit's
    // confirmQuitIfNeeded() would have no window left to render a dialog in.
    // Confirm here instead, while the window still exists, then destroy it for
    // real (bypassing this handler) so the quit proceeds without asking twice.
    const willQuitApp =
      process.platform !== "darwin" && otherWindows.length === 0 && !isAppQuitting();
    if (!willQuitApp) {
      return;
    }

    event.preventDefault();
    void (async () => {
      const confirmed = await confirmQuitIfNeeded();
      if (!confirmed) {
        return;
      }
      markQuitPreConfirmed();
      mainWindow.destroy();
    })();
  });
  mainWindow.on("hide", () => refreshTrayVisibility(TRAY_LIFECYCLE_OPTIONS));
  mainWindow.on("show", () => refreshTrayVisibility(TRAY_LIFECYCLE_OPTIONS));

  if (devWorktreeName) {
    app.dock?.setBadge(devWorktreeName);
  }

  if (restoredWindowState?.isMaximized) {
    mainWindow.maximize();
  }

  setupDarwinCompositorWatchdog(mainWindow);
  setupWindowResizeEvents(mainWindow);
  if (windowStateStore) {
    setupWindowStatePersistence(mainWindow, windowStateStore);
  }
  setupDragDropPrevention(mainWindow, trustedOttoOriginPolicy);
  setupCursorHoverForwarding(mainWindow);
  mainWindow.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    if (isArtifactWebviewAttach(params)) {
      pendingWebviewAttaches.push({ kind: "artifact" });
      hardenArtifactWebviewPreferences(webPreferences);
      delete params.preload;
      delete (params as { preloadURL?: string }).preloadURL;
      registerArtifactWebviewSessionGuards();
      return;
    }
    if (isMermaidWebviewAttach(params)) {
      pendingWebviewAttaches.push({ kind: "mermaid" });
      hardenMermaidWebviewPreferences(webPreferences);
      delete params.preload;
      delete (params as { preloadURL?: string }).preloadURL;
      registerMermaidWebviewSessionGuards();
      return;
    }
    if (isWidgetWebviewAttach(params)) {
      pendingWebviewAttaches.push({ kind: "widget" });
      // Order matters: drop whatever preload the renderer asked for FIRST, then
      // let the hardener install the main-process-owned path. A widget guest is
      // the one guest type that gets a preload at all - it has to report its
      // own content height - and the renderer never gets to choose the file.
      delete params.preload;
      delete (params as { preloadURL?: string }).preloadURL;
      hardenWidgetWebviewPreferences(webPreferences);
      registerWidgetWebviewSessionGuards();
      return;
    }
    if (isVisualizerWebviewAttach(params)) {
      pendingWebviewAttaches.push({ kind: "visualizer" });
      hardenVisualizerWebviewPreferences(webPreferences);
      delete params.preload;
      delete (params as { preloadURL?: string }).preloadURL;
      registerVisualizerWebviewSessionGuards();
      return;
    }
    if (!isOttoBrowserWebviewAttach(params)) {
      event.preventDefault();
      return;
    }
    pendingWebviewAttaches.push({ kind: "browser" });
    webPreferences.nodeIntegration = false;
    // The sandboxed keyboard preload must run in every frame so focused iframes
    // keep the same page-first shortcut boundary. Node integration stays off.
    webPreferences.nodeIntegrationInSubFrames = true;
    webPreferences.nodeIntegrationInWorker = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.webviewTag = false;
    webPreferences.allowRunningInsecureContent = false;
    // Order matters: drop whatever preload the renderer asked for first, then
    // install the main-process-owned path. The renderer never gets to choose.
    delete webPreferences.preload;
    delete params.preload;
    delete (webPreferences as { preloadURL?: string }).preloadURL;
    delete (params as { preloadURL?: string }).preloadURL;
    webPreferences.preload = getBrowserKeyboardPreloadPath();
  });
  mainWindow.webContents.on("did-attach-webview", (_event, contents) => {
    const pending = pendingWebviewAttaches.shift() ?? null;
    if (pending?.kind === "artifact") {
      lockDownArtifactWebviewContents(contents);
      return;
    }
    if (pending?.kind === "mermaid") {
      lockDownMermaidWebviewContents(contents);
      registerMermaidWebviewDiagnostics(contents);
      return;
    }
    if (pending?.kind === "widget") {
      lockDownWidgetWebviewContents(contents);
      return;
    }
    if (pending?.kind === "visualizer") {
      lockDownVisualizerWebviewContents(contents);
      registerVisualizerWebviewDiagnostics(contents);
      return;
    }
    if (pending?.kind === "browser") {
      // The renderer completes registration over "otto:browser:register-attached"
      // once it knows this guest's webContentsId; main only primes it here.
      prepareOttoBrowserWebContents(contents);
    }
    // Reserved shortcuts (reload, force-reload, focus-url) and host-owned chord
    // forwarding are handled by browserKeyboard.attach(), which runs once the
    // renderer completes registration and the guest has a browserId to scope to.
    contents.setWindowOpenHandler(({ url, disposition, frameName, features, postBody }) => {
      const decision = decideBrowserWindowOpenRequest({
        url,
        disposition,
        frameName,
        features,
        hasPostBody: postBody !== undefined && postBody !== null,
      });
      if (decision.kind === "deny") {
        return { action: "deny" };
      }
      if (decision.kind === "popup") {
        return {
          action: "allow",
          overrideBrowserWindowOptions: getBrowserPopupWindowOptions(mainWindow),
        };
      }
      const sourceBrowserId = getOttoBrowserIdForWebContents(contents);
      if (sourceBrowserId) {
        mainWindow.webContents.send(BROWSER_NEW_TAB_REQUEST_EVENT, {
          sourceBrowserId,
          url: decision.url,
        });
      } else {
        pendingBrowserWindowOpenRequests.add(contents.id, decision.url);
      }
      return { action: "deny" };
    });
    contents.on("context-menu", (_contextMenuEvent, params) => {
      showBrowserWebviewContextMenu(mainWindow, contents, params);
    });
    registerBrowserWebviewNavigationGuards(contents);
  });

  // Deferred reveal: show the window when the renderer signals its first durable
  // screen is ready (otto:window:signalReady), not on raw first paint. Under slow
  // software rendering, first paint lands mid-boot and would expose the
  // Workspaces → splash → Workspaces transient; hardware acceleration hides it
  // only by accident of frame timing. A fallback timer guarantees the window
  // still shows if the renderer never signals (older web bundle, hang).
  const WINDOW_REVEAL_FALLBACK_MS = 4_000;
  let revealFallbackTimer: NodeJS.Timeout | null = null;
  let hasRevealed = false;
  const revealWindow = (): void => {
    if (hasRevealed || mainWindow.isDestroyed()) {
      return;
    }
    hasRevealed = true;
    if (revealFallbackTimer) {
      clearTimeout(revealFallbackTimer);
      revealFallbackTimer = null;
    }
    clearPendingWindowReveal(webContentsId);
    // Reaching a revealed window - by ANY path: the renderer's boot-settled signal
    // (otto:window:signalReady), first paint (ready-to-show), or the fallback timer
    // - proves the graphics path works this launch, so disarm the GPU startup watch
    // (paint watchdog + sentinel) here, not only on `ready-to-show`. That event
    // never fires on some software-rendering VM guests (VMware "No 3D enabled"),
    // where the window still reveals fine via signalReady on native Wayland; tying
    // the disarm to `ready-to-show` alone let the 15s paint watchdog fire on those
    // healthy windows and needlessly relaunch into the (flaky, on Wayland) X11
    // software-rendering fallback.
    markGpuStartupHealthy();
    if (shouldStartMinimizedToTray) {
      // Window stays hidden (created with show: false); surface the tray icon
      // immediately instead of waiting for a hide/show transition to trigger it.
      refreshTrayVisibility(TRAY_LIFECYCLE_OPTIONS);
      return;
    }
    mainWindow.show();
    mainWindow.focus();
  };
  registerPendingWindowReveal(webContentsId, revealWindow);

  mainWindow.once("ready-to-show", () => {
    // The first window painted - the graphics path works this launch, so disarm
    // the startup watch that would otherwise flip the next launch to software
    // rendering. Fires even when the window stays hidden (start-minimized).
    markGpuStartupHealthy();
    if (shouldStartMinimizedToTray) {
      // Not showing a window this launch - reveal now (surfaces the tray) rather
      // than waiting on a renderer signal we don't need.
      revealWindow();
      return;
    }
    // Painted, but hold the reveal for the renderer's boot-settled signal so the
    // startup transient isn't shown. Cap it so a renderer that never signals
    // (older web bundle, hang) still reveals.
    revealFallbackTimer = setTimeout(revealWindow, WINDOW_REVEAL_FALLBACK_MS);
    revealFallbackTimer.unref?.();
  });

  if (!app.isPackaged) {
    const { loadReactDevTools } = await import("./features/react-devtools.js");
    await loadReactDevTools();
    const initialUrl = options.initialRoute
      ? new URL(options.initialRoute, `${DEV_SERVER_URL}/`).toString()
      : DEV_SERVER_URL;
    await mainWindow.loadURL(initialUrl);
    return mainWindow;
  }

  await mainWindow.loadURL(`${APP_SCHEME}://app${options.initialRoute ?? "/"}`);
  return mainWindow;
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

// Resolves once bootstrap() has registered the custom protocol handler and IPC
// handlers and created the first window. second-instance window creation waits
// on this rather than app.whenReady(): in packaged mode createWindow loads
// `otto://app/`, which fails if the protocol handler isn't registered yet, and
// a second instance can arrive mid-cold-start.
let resolveBootstrapComplete: () => void;
let bootstrapIsComplete = false;
const bootstrapComplete = new Promise<void>((resolve) => {
  resolveBootstrapComplete = resolve;
});

let agentNavigationWindowCreation: Promise<BrowserWindow> | null = null;

// Bring an agent link to the front. With no usable window (all closed, or the
// app was launched by the link itself) this mints one already pointed at the
// agent route, and serialises concurrent links onto that single creation so a
// burst of links cannot open a window each.
function focusExistingWindowOnAgent(target: AgentDeepLinkTarget): void {
  const windows = BrowserWindow.getAllWindows();
  const mainWindow =
    BrowserWindow.getFocusedWindow() ?? windows.find((window) => window.isVisible()) ?? windows[0];
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (!agentNavigationWindowCreation) {
      const creation = createWindow({
        initialRoute: buildAgentDeepLinkRoute(target),
        restoreWindowState: true,
      });
      agentNavigationWindowCreation = creation;
      void creation
        .catch((error) => log.error("[window] failed to create window for agent link", error))
        .finally(() => {
          if (agentNavigationWindowCreation === creation) {
            agentNavigationWindowCreation = null;
          }
        });
      return;
    }

    void agentNavigationWindowCreation
      .then(() => focusExistingWindowOnAgent(target))
      .catch((error) => log.error("[window] failed to deliver queued agent link", error));
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();

  const deliverable = agentNavigationInbox.deliverOrQueue(mainWindow.webContents.id, target);
  if (deliverable) {
    mainWindow.webContents.send("otto:event:open-agent", deliverable);
  }
}

function receiveAgentDeepLink(input: string): void {
  const target = parseAgentDeepLink(input);
  if (!target) {
    return;
  }

  if (bootstrapIsComplete) {
    focusExistingWindowOnAgent(target);
    return;
  }

  // Still cold-starting: hold the newest link and let bootstrap deliver it.
  pendingAgentNavigation = target;
  void bootstrapComplete.then(() => {
    if (pendingAgentNavigation !== target) {
      return undefined;
    }
    pendingAgentNavigation = null;
    focusExistingWindowOnAgent(target);
    return undefined;
  });
}

// macOS delivers links here rather than in argv.
app.on("open-url", (event, url) => {
  event.preventDefault();
  receiveAgentDeepLink(url);
});

function deliverOpenTarget(target: OpenTarget): void {
  const windows = BrowserWindow.getAllWindows();
  const mainWindow =
    BrowserWindow.getFocusedWindow() ?? windows.find((window) => window.isVisible()) ?? windows[0];
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingOpenTarget = target;
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  pendingOpenProjectStore.setTarget(mainWindow.webContents.id, target);
  mainWindow.webContents.send("otto:event:open-target", target);
}

// macOS delivers document associations here rather than in argv.
app.on("open-file", (event, filePath) => {
  event.preventDefault();
  const target: OpenTarget = { kind: "file", path: filePath };
  if (bootstrapIsComplete) {
    deliverOpenTarget(target);
  } else {
    pendingOpenTarget = target;
  }
});

function setupSingleInstanceLock(): boolean {
  if (DISABLE_SINGLE_INSTANCE_LOCK) {
    log.info("[single-instance] disabled by OTTO_DISABLE_SINGLE_INSTANCE_LOCK");
    return true;
  }

  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return false;
  }

  app.on("second-instance", (_event, commandLine) => {
    // Windows/Linux deliver a link by relaunching with it in argv. Focusing the
    // existing window is the whole point, so this returns before the
    // open-project path below can mint a second one.
    const agentTarget = parseAgentDeepLinkFromArgv(commandLine);
    if (agentTarget) {
      void bootstrapComplete.then(() => focusExistingWindowOnAgent(agentTarget));
      return;
    }

    const openTarget = parseOpenTargetFromArgv({
      argv: commandLine,
      isDefaultApp: false,
    });
    if (openTarget) {
      void bootstrapComplete.then(() => deliverOpenTarget(openTarget));
      return;
    }

    log.info("[open-project] second-instance commandLine:", commandLine);
    const openProjectPath = parseOpenProjectPathFromArgv({
      argv: commandLine,
      isDefaultApp: false,
    });
    log.info("[open-project] second-instance openProjectPath:", openProjectPath);
    // Relaunching the app (CLI `otto [path]`, double-click, etc.) opens a new
    // window rather than focusing the existing one. Wait for bootstrap (not just
    // app.whenReady) so the protocol + IPC handlers exist before the window loads.
    void bootstrapComplete
      .then(() => createWindow({ pendingOpenProjectPath: openProjectPath }))
      .catch((error) => {
        log.error("[window] failed to create window from second-instance", error);
      });
  });

  return true;
}

async function runCliPassthroughIfRequested(): Promise<boolean> {
  const cliArgs = parsePassthroughCliArgsFromArgv(process.argv);
  if (!cliArgs) {
    return false;
  }

  // This path exits without ever creating a window. Leave a breadcrumb: a
  // launch that lands here by accident (an installer or OS flag the parser
  // doesn't recognize) is otherwise indistinguishable from "the app never
  // started" - no window, no error, nothing in the log.
  log.info("[startup] running as CLI passthrough", { args: cliArgs });

  try {
    const exitCode = await runPassthroughCli(cliArgs);
    app.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    app.exit(1);
  }

  return true;
}

async function runDesktopSmokeIfRequested(): Promise<boolean> {
  if (process.env[DESKTOP_SMOKE_ENV] !== "1") {
    return false;
  }

  const handlers = createDaemonCommandHandlers();
  const startStatus = await handlers.start_desktop_daemon();
  process.stdout.write(
    `[otto-smoke] ${JSON.stringify({
      type: "desktop-daemon-smoke-started",
      status: startStatus,
    })}\n`,
  );

  await waitForDesktopSmokeStopRequest();

  const stopStatus = await handlers.stop_desktop_daemon();
  process.stdout.write(
    `[otto-smoke] ${JSON.stringify({
      type: "desktop-daemon-smoke-stopped",
      stopStatus,
    })}\n`,
  );

  app.exit(0);
  return true;
}

function waitForDesktopSmokeStopRequest(): Promise<void> {
  return new Promise((resolve) => {
    let buffer = "";
    const stop = () => {
      process.stdin.off("data", onData);
      resolve();
    };
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      if (buffer.includes(DESKTOP_SMOKE_STOP_REQUEST)) {
        stop();
      }
    };

    process.stdin.on("data", onData);
    process.stdin.resume();
  });
}

async function bootstrap(): Promise<void> {
  if (!setupSingleInstanceLock()) {
    return;
  }

  await app.whenReady();

  registerAppShellContentSecurityPolicy();

  const appDistDir = getAppDistDir();
  protocol.handle(APP_SCHEME, (request) => {
    const { pathname, search, hash } = new URL(request.url);
    const decodedPath = decodeURIComponent(pathname);

    // Chromium can occasionally request the exported entrypoint directly.
    // Canonicalize it back to the route URL so Expo Router sees `/`, not `/index.html`.
    if (decodedPath.endsWith("/index.html")) {
      const normalizedPath = decodedPath.slice(0, -"/index.html".length) || "/";
      return Response.redirect(`${APP_SCHEME}://app${normalizedPath}${search}${hash}`, 307);
    }

    const filePath = path.join(appDistDir, decodedPath);
    const relativePath = path.relative(appDistDir, filePath);

    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return new Response("Not found", { status: 404 });
    }

    // SPA fallback: serve index.html for routes without a file extension
    if (!relativePath || !path.extname(relativePath)) {
      return net.fetch(pathToFileURL(path.join(appDistDir, "index.html")).toString());
    }

    return net.fetch(pathToFileURL(filePath).toString());
  });

  await applyAppIcon();
  setupApplicationMenu({
    onNewWindow: () => {
      void createWindow().catch((error) => {
        log.error("[window] failed to create window from menu", error);
      });
    },
  });
  ensureNotificationCenterRegistration();
  if (await runDesktopSmokeIfRequested()) {
    return;
  }

  const initialDesktopSettings = await getDesktopSettingsStore().get();
  setCachedTrayIconSetting(initialDesktopSettings.tray.showIcon);
  setCachedMinimizeOnCloseSetting(initialDesktopSettings.tray.minimizeOnClose);
  registerDaemonManager({
    onDesktopSettingsChanged: (settings) => {
      setCachedTrayIconSetting(settings.tray.showIcon);
      setCachedMinimizeOnCloseSetting(settings.tray.minimizeOnClose);
      refreshTrayVisibility(TRAY_LIFECYCLE_OPTIONS);
    },
    isTrustedSender: (sender) => isTrustedMainWindowSender(sender, trustedOttoOriginPolicy),
  });
  registerWindowManager({
    isTrustedSender: (sender) => isTrustedMainWindowSender(sender, trustedOttoOriginPolicy),
  });
  // Surface a native dialog when a window's renderer dies, instead of leaving a
  // blank frame. Suppressed while the GPU fallback is relaunching into software
  // rendering, so we don't talk over our own recovery.
  registerCrashDialog({
    isSuppressed: isGpuRecoveryInProgress,
    getLogFilePath: () => {
      try {
        return log.transports.file.getFile().path;
      } catch {
        return null;
      }
    },
  });
  registerDialogHandlers();
  registerPrintToPdfHandlers();
  registerNotificationHandlers();
  registerOpenerHandlers();
  registerEditorTargetHandlers();
  registerWakeWordHandlers();
  registerZoomRecorderHandlers({
    isTrustedSender: (sender) => isTrustedMainWindowSender(sender, trustedOttoOriginPolicy),
  });
  registerBrowserAutomationIpc();

  // In-app "Open in new window": opens a window that lands on the given project
  // via the same open-project flow as a CLI launch (no move, no ownership).
  ipcMain.handle("otto:window:openNew", async (event, options?: unknown) => {
    requireTrustedMainRenderer(event);
    const pendingPath =
      options && typeof options === "object" && "pendingOpenProjectPath" in options
        ? (options as { pendingOpenProjectPath?: unknown }).pendingOpenProjectPath
        : null;
    await createWindow({
      pendingOpenProjectPath: typeof pendingPath === "string" ? pendingPath : null,
    });
  });

  // Arm the GPU startup watch on the GUI path only (CLI passthrough and smoke
  // runs return before reaching here). ready-to-show disarms it once the window
  // paints; a launch that never paints leaves it set for the next boot to
  // recover from.
  armGpuStartupSentinel();
  armGpuStartupPaintWatchdog();

  // The first window of the session restores and persists saved geometry. A
  // link that launched the app routes straight into it rather than being
  // delivered afterwards, so the window never paints the default route first.
  const initialAgentNavigation = pendingAgentNavigation;
  pendingAgentNavigation = null;
  await createWindow({
    initialRoute: initialAgentNavigation ? buildAgentDeepLinkRoute(initialAgentNavigation) : null,
    pendingOpenProjectPath,
    pendingOpenTarget,
    restoreWindowState: true,
  });
  pendingOpenProjectPath = null;
  pendingOpenTarget = null;

  // Protocol + IPC handlers and the first window now exist: release any
  // second-instance launches that arrived during cold start.
  bootstrapIsComplete = true;
  resolveBootstrapComplete();

  // A link that launched the app (argv) or landed mid-boot routes now that a
  // window exists to route it into.
  if (pendingAgentNavigation) {
    const target = pendingAgentNavigation;
    pendingAgentNavigation = null;
    focusExistingWindowOnAgent(target);
  }

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow({ restoreWindowState: true });
    }
  });
}

void runDesktopStartup({
  hasPendingGuiLaunchRequest: Boolean(pendingOpenProjectPath || pendingOpenTarget),
  runCliPassthroughIfRequested,
  inheritLoginShellEnv,
  bootstrapGui: bootstrap,
}).catch((error) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  // A GUI launch that never got off the ground otherwise dies silently - show a
  // native error box (works even when the renderer/GPU is what failed) before
  // exiting.
  showStartupErrorDialog(error);
  process.exit(1);
});

function showDaemonShutdownDialog(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("otto:event:quitting", {});
  }
}

// Prefers the focused window (the one the user is actually looking at), then
// falls back to any visible window, then whatever window exists at all - so a
// "warn before quitting" confirmation always has somewhere to render.
function pickWindowForQuitConfirm(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
  if (windows.length === 0) {
    return null;
  }
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) {
    return focused;
  }
  return windows.find((win) => win.isVisible()) ?? windows[0];
}

async function confirmQuitIfNeeded(): Promise<boolean> {
  if (consumeQuitPreConfirmation()) {
    log.info("[quit-confirm] skipped: already confirmed via the last window's close handler");
    return true;
  }

  const settings = await getDesktopSettingsStore().get();
  const willStopDaemon =
    shouldStopDesktopManagedDaemonOnQuit(settings) && isDesktopManagedDaemonRunningSync();
  // A quit that stops the managed daemon still round-trips to the renderer even
  // with warnBeforeQuit off: the renderer owns the (suppressible) "enabled
  // schedules won't run while the daemon is off" warning and silently confirms
  // when it doesn't apply.
  if (!settings.quit.warnBeforeQuit && !willStopDaemon) {
    log.info("[quit-confirm] skipped: warnBeforeQuit is off and the daemon keeps running", {
      quit: settings.quit,
    });
    return true;
  }

  const targetWindow = pickWindowForQuitConfirm();
  if (!targetWindow) {
    log.info("[quit-confirm] skipped: no window to render the confirmation in");
  }
  if (targetWindow && (targetWindow.isMinimized() || !targetWindow.isVisible())) {
    // The user can't answer a dialog rendered in a hidden (tray-minimized) or
    // OS-minimized window, so surface it first - before the request is sent,
    // so the window is already on screen when the dialog appears in it.
    log.info("[quit-confirm] restoring hidden/minimized window before asking");
    if (targetWindow.isMinimized()) {
      targetWindow.restore();
    }
    targetWindow.show();
    targetWindow.focus();
  }

  log.info("[quit-confirm] requesting renderer confirmation", {
    hasTargetWindow: Boolean(targetWindow),
    willStopDaemon,
  });
  const confirmed = await requestQuitConfirmation({ window: targetWindow, willStopDaemon });
  log.info("[quit-confirm] resolved", { confirmed });
  return confirmed;
}

// Runs before any window-close attempt in a real quit (app.quit()/Cmd+Q both fire
// 'before-quit' first), so the tray's close-to-tray interception can tell a real
// quit apart from the user clicking the window's close button.
app.on("before-quit", () => {
  markAppQuitting();
});

const quitLifecycle = createQuitLifecycle({
  app,
  closeTransportSessions: closeAllTransportSessions,
  confirmQuitIfNeeded,
  shutdownDesktopFeatures: shutdownZoomRecorderForQuit,
  stopDesktopManagedDaemonIfNeeded: () =>
    stopDesktopManagedDaemonOnQuitIfNeeded({
      settingsStore: getDesktopSettingsStore(),
      isDesktopManagedDaemonRunning: isDesktopManagedDaemonRunningSync,
      stopDaemon: () => stopDesktopDaemonViaCli("quit"),
      showShutdownFeedback: showDaemonShutdownDialog,
    }),
  installAppUpdateOnQuit: async (signal) => {
    const settings = await getDesktopSettingsStore().get();
    return installAppUpdateOnQuit({
      currentVersion: app.getVersion(),
      releaseChannel: settings.releaseChannel,
      signal,
    });
  },
  createUpdateDeadlineSignal: () => AbortSignal.timeout(UPDATE_QUIT_DEADLINE_MS),
  deferDaemonStopUntilUpdateHandoff: process.platform === "linux" && !process.env.APPIMAGE,
  onStopError: (error) => {
    log.error("[desktop daemon] failed to stop managed daemon on quit", error);
  },
  onShutdownError: (error) => {
    log.error("[zoom-recorder] failed to stop recorder on quit", error);
  },
  onUpdateError: (error) => {
    log.error("[auto-updater] failed to validate downloaded update on quit", error);
  },
});

// electron-updater forwards this event through Electron's built-in autoUpdater.
electronAutoUpdater.on("before-quit-for-update", quitLifecycle.handleBeforeQuitForUpdate);
app.on("before-quit", quitLifecycle.handleBeforeQuit);
registerExternalQuitSignals({ signals: process, quit: () => app.quit() });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    return;
  }
  // mac's native close behavior leaves the app running with no windows. Keep the
  // user-controlled tray icon synchronized in that state too.
  refreshTrayVisibility(TRAY_LIFECYCLE_OPTIONS);
});
