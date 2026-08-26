import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, shell } from "electron";
import log from "electron-log/main";
import { UUID } from "builder-util-runtime";
import { autoUpdater } from "electron-updater";
import {
  MANUAL_DOWNLOAD_URL,
  ManualDownloadUpdateRuntime,
} from "./manual-download-update-runtime.js";
import {
  createAppUpdateService,
  type AppUpdateCheckResult,
  type AppUpdateInstallResult,
  type AppUpdateRuntime,
  type AppUpdateRuntimeConfiguration,
  type RuntimeUpdateCheckResult,
  type RuntimeUpdateInfo,
} from "./app-update-service.js";
import {
  bucketFromStagingUserId,
  rolloutManifestSchema,
  shouldAdmitAppUpdate,
  type AppReleaseChannel,
  type AppUpdateCheckIntent,
} from "./app-update-rollout.js";

export {
  bucketFromStagingUserId,
  rolloutManifestSchema,
  shouldAdmitAppUpdate,
  type AppReleaseChannel,
  type AppUpdateCheckIntent,
  type AppUpdateCheckResult,
  type AppUpdateInstallResult,
};

let cachedStagingUserIdPromise: Promise<string> | null = null;

const UPDATE_CHANNEL_NOT_PUBLISHED_CODE = "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND";
const loggedUpdaterErrors = new WeakSet<object>();

function isUpdateChannelNotPublished(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === UPDATE_CHANNEL_NOT_PUBLISHED_CODE
  );
}

function claimUpdaterError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return true;
  if (loggedUpdaterErrors.has(error)) return false;
  loggedUpdaterErrors.add(error);
  return true;
}

function logUpdaterError(context: string, error: unknown): void {
  if (!claimUpdaterError(error)) return;
  log.error(`[auto-updater] ${context}`, error);
}

function logElectronUpdaterError(error: unknown): void {
  // A release can become visible just before its platform manifest. Keep that
  // expected publishing race in the main log without presenting it as a failed
  // user update.
  if (isUpdateChannelNotPublished(error)) {
    if (!claimUpdaterError(error)) return;
    log.warn("[auto-updater] Update channel manifest is not published yet", error);
    return;
  }
  logUpdaterError("electron-updater reported an error", error);
}

export function shouldAdmitToRollout(args: {
  channel: AppReleaseChannel;
  rolloutHours: number | undefined;
  releaseDate: string | undefined;
  now: number;
  bucket: number;
}): boolean {
  return shouldAdmitAppUpdate({ ...args, intent: "automatic" });
}

export async function resolveStagingUserId(filePath: string): Promise<string> {
  try {
    const id = (await readFile(filePath, "utf8")).trim();
    if (UUID.check(id)) {
      return id;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[auto-updater] Couldn't read staging user ID, creating a blank one: ${error}`);
    }
  }

  const id = UUID.v5(randomBytes(4096), UUID.OID);

  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, id);
  } catch (error) {
    console.warn(`[auto-updater] Couldn't write out staging user ID: ${error}`);
  }

  return id;
}

export function getStagingUserId(): Promise<string> {
  if (cachedStagingUserIdPromise == null) {
    cachedStagingUserIdPromise = resolveStagingUserId(
      path.join(app.getPath("userData"), ".updaterId"),
    );
  }
  return cachedStagingUserIdPromise;
}

export function shouldInstallAppUpdateOnQuit(input: {
  platform: NodeJS.Platform;
  isAppImage: boolean;
}): boolean {
  // AppImage's no-relaunch install path blocks while launching the replacement
  // binary, which can hang after the running file has already been replaced.
  return !(input.platform === "linux" && input.isAppImage);
}

export function shouldStopDesktopManagedDaemonBeforeAppUpdate(input: {
  platform: NodeJS.Platform;
  isAppImage: boolean;
}): boolean {
  // deb/rpm updates synchronously request polkit or sudo before Electron gets
  // the updater quit handoff. A cancelled prompt must leave Otto usable.
  return !(input.platform === "linux" && !input.isAppImage);
}

class ElectronAppUpdateRuntime implements AppUpdateRuntime {
  private configured = false;

  configure(input: AppUpdateRuntimeConfiguration): void {
    autoUpdater.autoDownload = true;
    autoUpdater.autoRunAppAfterInstall = true;
    // Otto revalidates the current manifest before explicitly installing on quit.
    // Electron's built-in handler would install an older download without checking
    // whether a newer release has superseded it.
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = input.releaseChannel === "beta";
    autoUpdater.channel = input.releaseChannel === "beta" ? "beta" : "latest";
    autoUpdater.allowDowngrade = false;
    autoUpdater.isUserWithinRollout = async (info) => {
      try {
        return await input.shouldAdmitUpdate(info as RuntimeUpdateInfo);
      } catch {
        return true;
      }
    };

    if (this.configured) return;
    this.configured = true;

    log.info("[auto-updater] configured", {
      channel: autoUpdater.channel,
      platform: process.platform,
      isAppImage: Boolean(process.env.APPIMAGE),
    });

    // Electron-updater owns the package-manager invocation on Linux. Forward
    // every one of its lifecycle messages to the Electron main-process log so
    // a failed elevation prompt or package command remains diagnosable after
    // the app has quit. logUpdaterError de-duplicates the same Error when it
    // subsequently arrives through the updater event or promise path.
    autoUpdater.logger = {
      debug: (message) => log.debug("[auto-updater] electron-updater", message),
      error: logElectronUpdaterError,
      info: (message) => log.info("[auto-updater] electron-updater", message),
      warn: (message) => log.warn("[auto-updater] electron-updater", message),
    };

    autoUpdater.on("update-available", (info) => {
      log.info("[auto-updater] update available", { version: info.version });
      input.onUpdateAvailable(info as RuntimeUpdateInfo);
    });
    autoUpdater.on("update-downloaded", (info) => {
      log.info("[auto-updater] update downloaded", { version: info.version });
      input.onUpdateDownloaded(info as RuntimeUpdateInfo);
    });
    autoUpdater.on("update-not-available", () => {
      log.info("[auto-updater] no update available");
      input.onUpdateNotAvailable();
    });
    autoUpdater.on("error", (error) => {
      if (isUpdateChannelNotPublished(error)) {
        logElectronUpdaterError(error);
        return;
      }
      logUpdaterError("updater event failed", error);
      input.onError(error);
    });
  }

  async checkForUpdates(): Promise<RuntimeUpdateCheckResult | null> {
    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result) return null;
      return {
        isUpdateAvailable: result.isUpdateAvailable,
        updateInfo: result.updateInfo as RuntimeUpdateInfo,
      };
    } catch (error) {
      if (isUpdateChannelNotPublished(error)) return null;
      logUpdaterError("failed to check for updates", error);
      throw error;
    }
  }

  downloadUpdate(): Promise<unknown> {
    log.info("[auto-updater] downloading update");
    return autoUpdater.downloadUpdate();
  }

  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void {
    autoUpdater.autoRunAppAfterInstall = isForceRunAfter;
    log.info("[auto-updater] handing downloaded update to installer", {
      isSilent,
      isForceRunAfter,
      platform: process.platform,
      isAppImage: Boolean(process.env.APPIMAGE),
    });
    autoUpdater.quitAndInstall(isSilent, isForceRunAfter);
  }
}

// COMPAT(macOS-signing): mac builds are unsigned, so they cannot replace
// themselves in place - see manual-download-update-runtime.ts for why. They
// still get told an update exists; "Update now" opens the download page.
// Drop this split once Apple signing is configured.
const usesManualDownload = process.platform === "darwin";

const manualDownloadRuntime = new ManualDownloadUpdateRuntime({
  currentVersion: () => app.getVersion(),
});

const appUpdateService = createAppUpdateService({
  runtime: usesManualDownload ? manualDownloadRuntime : new ElectronAppUpdateRuntime(),
  isPackaged: () => app.isPackaged,
  now: () => Date.now(),
  bucket: async () => bucketFromStagingUserId(await getStagingUserId()),
  reportCheckError: (error) => {
    logUpdaterError("failed to check for updates", error);
  },
  reportRuntimeError: (error) => {
    logUpdaterError("updater event failed", error);
  },
  reportInstallError: (message) => {
    logUpdaterError("failed to download or install update", message);
  },
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function checkForAppUpdate({
  currentVersion,
  releaseChannel,
  intent,
}: {
  currentVersion: string;
  releaseChannel: AppReleaseChannel;
  intent: AppUpdateCheckIntent;
}): Promise<AppUpdateCheckResult> {
  return appUpdateService.checkForAppUpdate({ currentVersion, releaseChannel, intent });
}

export async function downloadAndInstallUpdate(
  {
    currentVersion,
    releaseChannel,
  }: {
    currentVersion: string;
    releaseChannel: AppReleaseChannel;
  },
  onBeforeQuit?: () => Promise<void>,
): Promise<AppUpdateInstallResult> {
  if (usesManualDownload) {
    // Nothing to install: hand the user the download page and leave the running
    // app alone. Reporting installed:false keeps the UI honest - the update is
    // not applied until they replace the app themselves.
    await shell.openExternal(MANUAL_DOWNLOAD_URL);
    return {
      installed: false,
      outcome: "deferred",
      version: manualDownloadRuntime.latestVersion ?? currentVersion,
      message:
        "Opened the download page. macOS builds are unsigned, so update by replacing Otto in your Applications folder.",
    };
  }

  return appUpdateService.downloadAndInstallUpdate(
    { currentVersion, releaseChannel },
    onBeforeQuit,
  );
}

export async function installAppUpdateOnQuit({
  currentVersion,
  releaseChannel,
  signal,
}: {
  currentVersion: string;
  releaseChannel: AppReleaseChannel;
  signal: AbortSignal;
}): Promise<boolean> {
  if (
    !shouldInstallAppUpdateOnQuit({
      platform: process.platform,
      isAppImage: Boolean(process.env.APPIMAGE),
    })
  ) {
    return false;
  }

  return appUpdateService.installUpdateOnQuit({ currentVersion, releaseChannel, signal });
}
