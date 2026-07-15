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
  BrowserWindow,
  clipboard,
  Menu,
  ipcMain,
  nativeImage,
  net,
  protocol,
  screen,
  session,
} from "electron";
import { createDaemonCommandHandlers, registerDaemonManager } from "./daemon/daemon-manager.js";
import { parsePassthroughCliArgsFromArgv, runPassthroughCli } from "./daemon/cli/passthrough.js";
import { closeAllTransportSessions } from "./daemon/local-transport.js";
import {
  registerWindowManager,
  registerPendingWindowReveal,
  clearPendingWindowReveal,
  getMainWindowChromeOptions,
  getWindowBackgroundColor,
  resolveSystemWindowTheme,
  resolveWindowBounds,
  setupWindowResizeEvents,
  setupWindowStatePersistence,
  setupDefaultContextMenu,
  setupDragDropPrevention,
  setupCursorHoverForwarding,
  buildStandardContextMenuItems,
} from "./window/window-manager.js";
import { setupDarwinCompositorWatchdog } from "./window/compositor-watchdog/index.js";
import { registerDialogHandlers } from "./features/dialogs.js";
import {
  registerNotificationHandlers,
  ensureNotificationCenterRegistration,
} from "./features/notifications.js";
import { registerOpenerHandlers } from "./features/opener.js";
import { registerEditorTargetHandlers } from "./features/editor-targets.js";
import { setupApplicationMenu } from "./features/menu.js";
import {
  BROWSER_NEW_TAB_REQUEST_EVENT,
  getOttoBrowserIdForWebContents,
  getOttoBrowserWebContents,
  handleBrowserWindowOpenRequest,
  listRegisteredOttoBrowserIds,
  readBrowserIdFromWebviewAttach,
  registerBrowserWebviewNavigationGuards,
  unregisterOttoBrowser,
  registerOttoBrowserWorkspace,
  registerOttoBrowserWebContents,
  setWorkspaceActiveOttoBrowserId,
} from "./features/browser-webviews/index.js";
import {
  hardenArtifactWebviewPreferences,
  isArtifactWebviewAttach,
  lockDownArtifactWebviewContents,
  registerArtifactWebviewSessionGuards,
} from "./features/artifact-webview.js";
import { parseOpenProjectPathFromArgv } from "./open-project-routing.js";
import { PendingOpenProjectStore } from "./pending-open-project-store.js";
import { getDesktopSettingsStore } from "./settings/desktop-settings-electron.js";
import { clampWindowStateToWorkAreas, createWindowStateStore } from "./settings/window-state.js";
import {
  isDesktopManagedDaemonRunningSync,
  stopDesktopDaemonViaCli,
} from "./daemon/daemon-manager.js";
import {
  createBeforeQuitHandler,
  shouldStopDesktopManagedDaemonOnQuit,
  stopDesktopManagedDaemonOnQuitIfNeeded,
  markAppQuitting,
  isAppQuitting,
} from "./daemon/quit-lifecycle.js";
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
import { autoUpdateInstalledSkills } from "./integrations/skills/index.js";
import { registerBrowserAutomationIpc } from "./features/browser-automation/ipc.js";
import {
  getCachedMinimizeOnCloseSetting,
  refreshTrayVisibility,
  setCachedMinimizeOnCloseSetting,
  shouldHideWindowOnClose,
  type TrayLifecycleOptions,
} from "./features/tray.js";

const DEV_SERVER_URL = process.env.EXPO_DEV_URL ?? "http://localhost:8081";
const APP_SCHEME = "otto";
const OTTO_DEBUG = process.env.OTTO_DEBUG === "1";
const DISABLE_SINGLE_INSTANCE_LOCK = process.env.OTTO_DISABLE_SINGLE_INSTANCE_LOCK === "1";
const APP_NAME = process.env.OTTO_TEST_APP_NAME?.trim() || "Otto";

const BROWSER_SHORTCUT_EVENT = "otto:event:browser-shortcut";
const BROWSER_FORWARDED_KEY_EVENT = "otto:event:browser-forwarded-key";

const FORWARDED_OTTO_SHORTCUT_KEYS = new Set([
  "b",
  "e",
  "w",
  "t",
  "k",
  "o",
  "/",
  "\\",
  ",",
  ".",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "enter",
  "arrowleft",
  "arrowright",
  "arrowup",
  "arrowdown",
]);
const DESKTOP_SMOKE_ENV = "OTTO_DESKTOP_SMOKE";
const DESKTOP_SMOKE_STOP_REQUEST = "otto-smoke-stop";
app.setName(APP_NAME);

// Windows identifies notification senders and routes toast clicks by
// AppUserModelID, not app.getName(). Without this, Windows falls back to
// Electron's own default identity, so toasts are labeled "Electron" and
// clicking one launches a bare electron.exe instead of activating us.
// Must match electron-builder's `appId` so the installed NSIS shortcut
// (which electron-builder registers under this same AUMID) resolves back
// to this app.
if (process.platform === "win32") {
  app.setAppUserModelId("ai.ottocode.desktop");
}

// CSP for the app shell's own session only (registered on defaultSession, which
// the main window uses). Browser-webview guests run on separate
// `persist:otto-browser-*` partitions and are untouched by this policy — they
// browse arbitrary third-party sites, so imposing our own CSP there would be
// both wrong (it's not our content) and easily broken by real-world pages.
//
// connect-src stays wide open (any http/https/ws/wss origin): Otto's core
// multi-host feature lets users point the renderer at arbitrary daemon hosts
// (LAN, Tailscale, the relay), so a fixed allowlist would break that. The
// actual security value here is script-src/object-src/base-uri — blocking
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
  "script-src 'self' 'unsafe-eval'",
  ...CSP_SHARED_DIRECTIVES,
].join("; ");
const PROD_CONTENT_SECURITY_POLICY = ["script-src 'self'", ...CSP_SHARED_DIRECTIVES].join("; ");

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

function readBrowserWorkspaceInput(
  input: unknown,
): { browserId: string; workspaceId: string } | null {
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
  return { browserId: record.browserId.trim(), workspaceId: record.workspaceId.trim() };
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

type PendingWebviewAttach = { kind: "browser"; browserId: string } | { kind: "artifact" };
const pendingWebviewAttaches: PendingWebviewAttach[] = [];

function isBrowserRefreshInput(input: Electron.Input): boolean {
  if (input.type !== "keyDown" || input.alt || input.shift) {
    return false;
  }
  return (input.meta || input.control) && input.key.toLowerCase() === "r";
}

function isBrowserLocationInput(input: Electron.Input): boolean {
  if (input.type !== "keyDown" || input.alt || input.shift) {
    return false;
  }
  return (input.meta || input.control) && input.key.toLowerCase() === "l";
}

function isForwardableOttoShortcutInput(input: Electron.Input): boolean {
  if (input.type !== "keyDown") {
    return false;
  }
  if (!input.meta && !input.control) {
    return false;
  }
  return FORWARDED_OTTO_SHORTCUT_KEYS.has(input.key.toLowerCase());
}

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
    // Main checkout (e.g. "otto") gets default userData — only worktrees diverge.
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

// The renderer pulls the pending path on mount via IPC — this avoids
// a race where the push event arrives before React registers its listener.
ipcMain.handle("otto:get-pending-open-project", (event) => {
  const webContentsId = event.sender.id;
  const result = pendingOpenProjectStore.take(webContentsId);
  log.info("[open-project] renderer requested pending path:", {
    webContentsId,
    pendingPath: result,
  });
  return result;
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

ipcMain.handle("otto:browser:register-workspace-browser", (_event, rawInput: unknown) => {
  const input = readBrowserWorkspaceInput(rawInput);
  if (input) {
    registerOttoBrowserWorkspace(input);
  }
});

ipcMain.handle("otto:browser:unregister-workspace-browser", (_event, browserId: unknown) => {
  if (typeof browserId === "string" && browserId.trim().length > 0) {
    unregisterOttoBrowser(browserId.trim());
  }
});

ipcMain.handle("otto:browser:set-workspace-active-browser", (_event, rawInput: unknown) => {
  const input = readActiveBrowserInput(rawInput);
  if (input) {
    setWorkspaceActiveOttoBrowserId(input);
  }
});

ipcMain.handle("otto:browser:open-devtools", (_event, browserId: unknown) => {
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
  const contents = getOttoBrowserWebContents(browserId);
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

ipcMain.handle("otto:browser:clear-partition", async (_event, browserId: unknown) => {
  if (typeof browserId !== "string" || browserId.trim().length === 0) {
    return;
  }
  const partition = `persist:otto-browser-${browserId}`;
  await session.fromPartition(partition).clearStorageData();
});

ipcMain.handle(
  "otto:browser:capture-element",
  async (_event, browserId: unknown, rect: unknown) => {
    if (typeof browserId !== "string" || browserId.trim().length === 0) {
      return null;
    }
    const contents = getOttoBrowserWebContents(browserId);
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
  },
);

ipcMain.handle("otto:browser:copy-element", (_event, payload: unknown): boolean => {
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
  if (process.platform === "win32") {
    return [
      path.resolve(__dirname, "../assets/icon.ico"),
      path.resolve(__dirname, "../assets/icon.png"),
    ];
  }
  return [path.resolve(__dirname, "../assets/icon.png")];
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
  onShowWindow: showMostRecentWindowOrCreateOne,
  onQuit: () => app.quit(),
};

function applyAppIcon(): void {
  if (process.platform !== "darwin") {
    return;
  }

  const iconPath = path.resolve(__dirname, "../assets/icon.png");
  if (!existsSync(iconPath)) {
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
    restoreWindowState?: boolean;
  } = {},
): Promise<BrowserWindow> {
  const iconPath = getWindowIconPath();
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

  // Only the first window of a session honors "start minimized to tray" — a
  // window opened later (⌘N, second-instance, "Open in new window") is an
  // explicit ask to see it. Mac has no tray-only mode to start into (see
  // shouldHideWindowOnClose's darwin exemption): the dock already keeps Otto
  // running with zero windows, so "minimized" there would just mean invisible
  // with no way back short of the dock icon.
  const shouldStartMinimizedToTray =
    restoreWindowState &&
    process.platform !== "darwin" &&
    (await getDesktopSettingsStore().get()).tray.startMinimized;

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
      restoredOverlay: restoredWindowState?.overlay ?? null,
    }),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  const webContentsId = mainWindow.webContents.id;
  pendingOpenProjectStore.set(webContentsId, options.pendingOpenProjectPath);
  mainWindow.on("closed", () => {
    pendingOpenProjectStore.delete(webContentsId);
    clearPendingWindowReveal(webContentsId);
  });

  // Windows/Linux: hide the last visible window to the tray instead of letting it
  // close, unless the user opted out or an app quit is already in flight. macOS's
  // native close behavior is untouched — the dock already keeps Otto running with
  // zero windows open, which is this feature's mac equivalent.
  mainWindow.on("close", (event) => {
    const otherWindows = BrowserWindow.getAllWindows().filter(
      (win) => win !== mainWindow && !win.isDestroyed(),
    );
    const otherVisibleWindowCount = otherWindows.filter((win) => win.isVisible()).length;
    const shouldHide = shouldHideWindowOnClose({
      platform: process.platform,
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
    // app.quit(), but by then this window is already destroyed — before-quit's
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
  setupDefaultContextMenu(mainWindow);
  setupDragDropPrevention(mainWindow);
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
    const browserId = readBrowserIdFromWebviewAttach(params);
    if (!browserId) {
      event.preventDefault();
      return;
    }
    pendingWebviewAttaches.push({ kind: "browser", browserId });
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.nodeIntegrationInWorker = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.webviewTag = false;
    webPreferences.allowRunningInsecureContent = false;
    delete webPreferences.preload;
    delete params.preload;
    delete (webPreferences as { preloadURL?: string }).preloadURL;
    delete (params as { preloadURL?: string }).preloadURL;
  });
  mainWindow.webContents.on("did-attach-webview", (_event, contents) => {
    const pending = pendingWebviewAttaches.shift() ?? null;
    if (pending?.kind === "artifact") {
      lockDownArtifactWebviewContents(contents);
      return;
    }
    const browserId = pending?.kind === "browser" ? pending.browserId : null;
    if (browserId) {
      registerOttoBrowserWebContents(contents, browserId);
      log.info("[browser-webview] registered", {
        browserId,
        webContentsId: contents.id,
        registeredBrowserIds: listRegisteredOttoBrowserIds(),
      });
    }
    contents.on("before-input-event", (event, input) => {
      if (isBrowserRefreshInput(input)) {
        event.preventDefault();
        if (contents.isLoadingMainFrame()) {
          contents.stop();
        } else {
          contents.reload();
        }
        return;
      }
      if (isBrowserLocationInput(input)) {
        event.preventDefault();
        const focusedBrowserId = getOttoBrowserIdForWebContents(contents);
        mainWindow.webContents.send(BROWSER_SHORTCUT_EVENT, {
          action: "focus-url",
          ...(focusedBrowserId ? { browserId: focusedBrowserId } : {}),
        });
        return;
      }
      if (isForwardableOttoShortcutInput(input)) {
        event.preventDefault();
        mainWindow.webContents.send(BROWSER_FORWARDED_KEY_EVENT, {
          key: input.key,
          code: input.code,
          meta: input.meta,
          control: input.control,
          shift: input.shift,
          alt: input.alt,
        });
      }
    });
    contents.setWindowOpenHandler(({ url }) =>
      handleBrowserWindowOpenRequest({
        url,
        sourceBrowserId: getOttoBrowserIdForWebContents(contents),
        requestNewTab: (payload) => {
          mainWindow.webContents.send(BROWSER_NEW_TAB_REQUEST_EVENT, payload);
        },
      }),
    );
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
    // The first window painted — the graphics path works this launch, so disarm
    // the startup watch that would otherwise flip the next launch to software
    // rendering. Fires even when the window stays hidden (start-minimized).
    markGpuStartupHealthy();
    if (shouldStartMinimizedToTray) {
      // Not showing a window this launch — reveal now (surfaces the tray) rather
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
    await mainWindow.loadURL(DEV_SERVER_URL);
    return mainWindow;
  }

  await mainWindow.loadURL(`${APP_SCHEME}://app/`);
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
const bootstrapComplete = new Promise<void>((resolve) => {
  resolveBootstrapComplete = resolve;
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

  applyAppIcon();
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
  setCachedMinimizeOnCloseSetting(initialDesktopSettings.tray.minimizeOnClose);
  registerDaemonManager({
    onDesktopSettingsChanged: (settings) =>
      setCachedMinimizeOnCloseSetting(settings.tray.minimizeOnClose),
  });
  registerWindowManager();
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
  registerNotificationHandlers();
  registerOpenerHandlers();
  registerEditorTargetHandlers();
  registerBrowserAutomationIpc();

  // In-app "Open in new window": opens a window that lands on the given project
  // via the same open-project flow as a CLI launch (no move, no ownership).
  ipcMain.handle("otto:window:openNew", async (_event, options?: unknown) => {
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

  // The first window of the session restores and persists saved geometry.
  await createWindow({ pendingOpenProjectPath, restoreWindowState: true });
  pendingOpenProjectPath = null;

  // Protocol + IPC handlers and the first window now exist: release any
  // second-instance launches that arrived during cold start.
  resolveBootstrapComplete();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow({ restoreWindowState: true });
    }
  });
}

void runDesktopStartup({
  hasPendingOpenProjectPath: Boolean(pendingOpenProjectPath),
  runCliPassthroughIfRequested,
  inheritLoginShellEnv,
  bootstrapGui: bootstrap,
  autoUpdateInstalledSkills: () => {
    void autoUpdateInstalledSkills().catch((error) => {
      log.error("[skills] auto-update failed", error);
    });
  },
}).catch((error) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  // A GUI launch that never got off the ground otherwise dies silently — show a
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
// falls back to any visible window, then whatever window exists at all — so a
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
  if (!settings.quit.warnBeforeQuit) {
    log.info("[quit-confirm] skipped: warnBeforeQuit is off", { quit: settings.quit });
    return true;
  }

  const targetWindow = pickWindowForQuitConfirm();
  if (!targetWindow) {
    log.info("[quit-confirm] skipped: no window to render the confirmation in");
  }
  if (targetWindow && (targetWindow.isMinimized() || !targetWindow.isVisible())) {
    // The user can't answer a dialog rendered in a hidden (tray-minimized) or
    // OS-minimized window, so surface it first — before the request is sent,
    // so the window is already on screen when the dialog appears in it.
    log.info("[quit-confirm] restoring hidden/minimized window before asking");
    if (targetWindow.isMinimized()) {
      targetWindow.restore();
    }
    targetWindow.show();
    targetWindow.focus();
  }

  const willStopDaemon =
    shouldStopDesktopManagedDaemonOnQuit(settings) && isDesktopManagedDaemonRunningSync();

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

app.on(
  "before-quit",
  createBeforeQuitHandler({
    app,
    closeTransportSessions: closeAllTransportSessions,
    confirmQuitIfNeeded,
    stopDesktopManagedDaemonIfNeeded: () =>
      stopDesktopManagedDaemonOnQuitIfNeeded({
        settingsStore: getDesktopSettingsStore(),
        isDesktopManagedDaemonRunning: isDesktopManagedDaemonRunningSync,
        stopDaemon: () => stopDesktopDaemonViaCli("quit"),
        showShutdownFeedback: showDaemonShutdownDialog,
      }),
    onStopError: (error) => {
      log.error("[desktop daemon] failed to stop managed daemon on quit", error);
    },
  }),
);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    return;
  }
  // mac's native close behavior already leaves the app running with no windows
  // (the dock icon persists); that state is this feature's mac equivalent of
  // "minimized to tray," so show the tray icon the same way the other platforms do.
  refreshTrayVisibility(TRAY_LIFECYCLE_OPTIONS);
});
