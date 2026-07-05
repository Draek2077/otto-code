import { existsSync } from "node:fs";
import path from "node:path";
import { app, BrowserWindow, Menu, Tray, nativeImage } from "electron";

// The tray icon only exists while the app has zero visible windows (mac: after the
// last window closes natively; Windows/Linux: after minimize-to-tray hides the last
// one). It disappears again the moment a window becomes visible. See branding/README.md
// for the icon geometry and packages/desktop/assets/tray-icon*.png for the generated art.

const TRAY_ASSET_NAMES = {
  idleWinLinux: "tray-icon.png",
  attentionWinLinux: "tray-icon-attention.png",
  idleMac: "tray-icon-mac.png",
  attentionMac: "tray-icon-mac-attention.png",
};

export interface TrayLifecycleOptions {
  onShowWindow: () => void;
  onQuit: () => void;
}

let tray: Tray | null = null;
let attentionActive = false;

export function resolveTrayAssetPath(fileName: string): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, fileName);
  }
  // dist/features/tray.js -> packages/desktop/assets/<fileName>
  return path.resolve(__dirname, "../../assets", fileName);
}

function resolveTrayAssetName(isMac: boolean, attention: boolean): string {
  if (isMac) {
    return attention ? TRAY_ASSET_NAMES.attentionMac : TRAY_ASSET_NAMES.idleMac;
  }
  return attention ? TRAY_ASSET_NAMES.attentionWinLinux : TRAY_ASSET_NAMES.idleWinLinux;
}

function loadTrayImage(attention: boolean): Electron.NativeImage {
  const isMac = process.platform === "darwin";
  const fileName = resolveTrayAssetName(isMac, attention);
  const iconPath = resolveTrayAssetPath(fileName);
  const image = existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();

  // Only the mac idle icon is a template image: Electron re-tints template images
  // for the current menu-bar theme, but that would desaturate the amber attention
  // accent, so the attention variant keeps its own tile background instead.
  if (isMac && !attention) {
    image.setTemplateImage(true);
  }
  return image;
}

function buildTrayMenu(options: TrayLifecycleOptions): Menu {
  const appName = app.getName();
  return Menu.buildFromTemplate([
    { label: `Show ${appName}`, click: options.onShowWindow },
    { type: "separator" },
    { label: `Quit ${appName}`, click: options.onQuit },
  ]);
}

function createTray(options: TrayLifecycleOptions): Tray {
  const created = new Tray(loadTrayImage(attentionActive));
  created.setToolTip(app.getName());
  created.setContextMenu(buildTrayMenu(options));
  if (process.platform !== "darwin") {
    created.on("click", options.onShowWindow);
  }
  return created;
}

/** True once any non-destroyed window is showing on screen. */
export function anyWindowVisible(): boolean {
  return BrowserWindow.getAllWindows().some((win) => !win.isDestroyed() && win.isVisible());
}

/**
 * Creates the tray icon when no window is visible, destroys it once one is.
 * Call this from every window visibility transition: hide/show/close/create.
 */
export function refreshTrayVisibility(options: TrayLifecycleOptions): void {
  if (anyWindowVisible()) {
    destroyTray();
    return;
  }
  if (!tray) {
    tray = createTray(options);
  }
}

export function setTrayAttention(active: boolean): void {
  attentionActive = active;
  if (tray) {
    tray.setImage(loadTrayImage(active));
  }
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}

export function isTrayVisible(): boolean {
  return tray !== null;
}

/**
 * Whether a window's 'close' handler should hide it to the tray instead of letting
 * it close. Pure so the close-vs-hide decision is unit-testable without a real
 * Electron window: darwin keeps its native close behavior untouched (the dock
 * already keeps the app alive with zero windows), an in-flight app quit must never
 * be intercepted, the user's setting is an explicit opt-out, and closing a non-last
 * window (another window still visible) should behave like an ordinary close.
 */
export function shouldHideWindowOnClose(input: {
  platform: NodeJS.Platform;
  minimizeOnCloseEnabled: boolean;
  isQuitting: boolean;
  otherVisibleWindowCount: number;
}): boolean {
  if (input.platform === "darwin") {
    return false;
  }
  if (input.isQuitting || !input.minimizeOnCloseEnabled) {
    return false;
  }
  return input.otherVisibleWindowCount === 0;
}

// ---------------------------------------------------------------------------
// In-memory settings mirror
// ---------------------------------------------------------------------------
// The close handler must decide synchronously (Electron's 'close' event isn't
// awaitable without a visible flash), so we mirror the persisted setting in memory
// instead of reading the async settings store on every close.

let cachedMinimizeOnCloseSetting = true;

export function setCachedMinimizeOnCloseSetting(value: boolean): void {
  cachedMinimizeOnCloseSetting = value;
}

export function getCachedMinimizeOnCloseSetting(): boolean {
  return cachedMinimizeOnCloseSetting;
}
