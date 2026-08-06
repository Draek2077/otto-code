import {
  rolloutManifestSchema,
  shouldAdmitAppUpdate,
  type AppReleaseChannel,
  type AppUpdateCheckIntent,
} from "./app-update-rollout.js";

export interface AppUpdateCheckResult {
  hasUpdate: boolean;
  readyToInstall: boolean;
  currentVersion: string;
  latestVersion: string;
  body: string | null;
  date: string | null;
  errorMessage: string | null;
}

/**
 * Why an install attempt ended. `installed` alone cannot carry this: "we could
 * not install" and "there was nothing to install" look identical to a caller,
 * so the UI used to render a failed download as "you are up to date".
 *
 *  - "installed": the app is quitting into the installer.
 *  - "deferred":  nothing was installed and nothing is wrong - superseded by a
 *                 newer release, still validating, or handed off to a manual
 *                 download (unsigned macOS).
 *  - "failed":    the download or install errored. `message` says how.
 */
export type AppUpdateInstallOutcome = "installed" | "deferred" | "failed";

export interface AppUpdateInstallResult {
  installed: boolean;
  outcome: AppUpdateInstallOutcome;
  version: string | null;
  message: string;
}

export interface RuntimeUpdateInfo {
  version: string;
  releaseNotes?: unknown;
  releaseDate?: unknown;
  rolloutHours?: unknown;
}

export interface RuntimeUpdateCheckResult {
  isUpdateAvailable: boolean;
  updateInfo: RuntimeUpdateInfo;
}

export interface AppUpdateRuntimeConfiguration {
  releaseChannel: AppReleaseChannel;
  shouldAdmitUpdate(info: RuntimeUpdateInfo): boolean | Promise<boolean>;
  onUpdateAvailable(info: RuntimeUpdateInfo): void;
  onUpdateDownloaded(info: RuntimeUpdateInfo): void;
  onUpdateNotAvailable(): void;
  onError(error: unknown): void;
}

export interface AppUpdateRuntime {
  configure(input: AppUpdateRuntimeConfiguration): void;
  checkForUpdates(): Promise<RuntimeUpdateCheckResult | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void;
}

export interface AppUpdateService {
  checkForAppUpdate(input: {
    currentVersion: string;
    releaseChannel: AppReleaseChannel;
    intent: AppUpdateCheckIntent;
  }): Promise<AppUpdateCheckResult>;
  downloadAndInstallUpdate(
    input: {
      currentVersion: string;
      releaseChannel: AppReleaseChannel;
    },
    onBeforeQuit?: () => Promise<void>,
  ): Promise<AppUpdateInstallResult>;
  installUpdateOnQuit(input: {
    currentVersion: string;
    releaseChannel: AppReleaseChannel;
    signal: AbortSignal;
  }): Promise<boolean>;
}

export interface AppUpdateServiceDeps {
  runtime: AppUpdateRuntime;
  isPackaged(): boolean;
  now(): number;
  bucket(): Promise<number>;
  reportCheckError?(error: unknown): void;
  reportRuntimeError?(error: unknown): void;
  reportInstallError?(message: string): void;
}

function buildCheckResult(input: {
  currentVersion: string;
  hasUpdate: boolean;
  readyToInstall: boolean;
  info?: RuntimeUpdateInfo | null;
  errorMessage?: string | null;
}): AppUpdateCheckResult {
  const { currentVersion, hasUpdate, readyToInstall, info, errorMessage = null } = input;

  return {
    hasUpdate,
    readyToInstall,
    currentVersion,
    latestVersion: info?.version ?? currentVersion,
    body: typeof info?.releaseNotes === "string" ? info.releaseNotes : null,
    date: typeof info?.releaseDate === "string" ? info.releaseDate : null,
    errorMessage,
  };
}

async function performQuitAndInstall(
  runtime: AppUpdateRuntime,
  {
    onBeforeQuit,
    restart,
  }: {
    onBeforeQuit?: () => Promise<void>;
    restart: boolean;
  },
): Promise<void> {
  if (onBeforeQuit) await onBeforeQuit();
  // Always silent, including the restart path. Otto ships an assisted NSIS
  // installer, and electron-builder's assisted template only relaunches the app
  // after a *silent* install: run it with its wizard UI and the --force-run flag
  // electron-updater passes is ignored outright, leaving the "Run Otto" checkbox
  // on the finish page as the only way back in. Otto has already told the user
  // it will restart itself and quit by then, so nobody is there to click Finish
  // and the update lands with the app dead. See docs/fork-release-guide.md.
  runtime.quitAndInstall(/* isSilent */ true, /* isForceRunAfter */ restart);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

function buildDeferredInstallResult(currentVersion: string): AppUpdateInstallResult {
  return {
    installed: false,
    outcome: "deferred",
    version: currentVersion,
    message: "Update validation timed out. The update will be installed later.",
  };
}

export function createAppUpdateService(deps: AppUpdateServiceDeps): AppUpdateService {
  let cachedUpdateInfo: RuntimeUpdateInfo | null = null;
  let downloadedUpdateVersion: string | null = null;
  let configuredReleaseChannel: AppReleaseChannel | null = null;
  let preparationError: { version: string; message: string } | null = null;
  let preparingUpdateVersion: string | null = null;
  let checkQueue: Promise<void> = Promise.resolve();
  /**
   * The version the most recent check was refused by the staged rollout, if any.
   *
   * The updater reports a rollout refusal as "no update available" - it has no
   * separate signal for "exists, but you are not admitted yet". Those two are
   * not interchangeable here: manual checks bypass the rollout on purpose, so an
   * automatic recheck landing on a deferral must not retract an update the user
   * has already been shown and is downloading. Set on every admission decision,
   * cleared at the start of each check so it only ever describes that check.
   */
  let rolloutDeferredVersion: string | null = null;

  function isReadyToInstallVersion(version: string): boolean {
    return downloadedUpdateVersion === version;
  }

  function clearUpdateState(): void {
    cachedUpdateInfo = null;
    downloadedUpdateVersion = null;
    preparationError = null;
    preparingUpdateVersion = null;
  }

  function configureRuntime(releaseChannel: AppReleaseChannel, intent: AppUpdateCheckIntent): void {
    if (configuredReleaseChannel !== releaseChannel) {
      clearUpdateState();
      configuredReleaseChannel = releaseChannel;
    }

    deps.runtime.configure({
      releaseChannel,
      shouldAdmitUpdate: async (info) => {
        const parsed = rolloutManifestSchema.parse(info);
        const admitted = shouldAdmitAppUpdate({
          channel: releaseChannel,
          intent,
          rolloutHours: parsed.rolloutHours,
          releaseDate: parsed.releaseDate,
          now: deps.now(),
          bucket: await deps.bucket(),
        });
        rolloutDeferredVersion = admitted ? null : info.version;
        return admitted;
      },
      onUpdateAvailable(info) {
        const alreadyReady = downloadedUpdateVersion === info.version;
        cachedUpdateInfo = info;
        downloadedUpdateVersion = alreadyReady ? info.version : null;
        if (!alreadyReady && preparingUpdateVersion === null) {
          preparingUpdateVersion = info.version;
        }
      },
      onUpdateDownloaded(info) {
        // A superseded download can finish after a newer manifest check. Keep
        // the validated manifest as the install target in that case.
        cachedUpdateInfo ??= info;
        downloadedUpdateVersion = info.version;
        if (preparingUpdateVersion === info.version) {
          preparingUpdateVersion = null;
        }
        if (preparationError?.version === info.version) {
          preparationError = null;
        }
      },
      onUpdateNotAvailable() {
        // A rollout deferral arrives as this same event. Dropping the cached
        // manifest here is what used to abandon an in-flight download.
        if (rolloutDeferredVersion !== null) return;
        clearUpdateState();
      },
      onError(error) {
        if (preparingUpdateVersion) {
          preparationError = {
            version: preparingUpdateVersion,
            message: getErrorMessage(error),
          };
          preparingUpdateVersion = null;
        }
        deps.reportRuntimeError?.(error);
      },
    });
  }

  function runCheckExclusively<T>(check: () => Promise<T>): Promise<T> {
    const result = checkQueue.then(check, check);
    checkQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function checkForAppUpdate({
    currentVersion,
    releaseChannel,
    intent,
  }: {
    currentVersion: string;
    releaseChannel: AppReleaseChannel;
    intent: AppUpdateCheckIntent;
  }): Promise<AppUpdateCheckResult> {
    if (!deps.isPackaged()) {
      return buildCheckResult({
        currentVersion,
        hasUpdate: false,
        readyToInstall: false,
      });
    }

    return runCheckExclusively(async () => {
      configureRuntime(releaseChannel, intent);
      rolloutDeferredVersion = null;

      try {
        const result = await deps.runtime.checkForUpdates();
        if (!result || !result.updateInfo || !result.isUpdateAvailable) {
          // Deferred by the rollout, for the update we already validated and
          // told the user about: keep offering it. An automatic check may add
          // an update, never retract one - the manual check that surfaced it
          // bypassed the rollout deliberately.
          const deferred = cachedUpdateInfo;
          if (deferred && rolloutDeferredVersion === deferred.version) {
            return buildCheckResult({
              currentVersion,
              hasUpdate: true,
              readyToInstall: isReadyToInstallVersion(deferred.version),
              info: deferred,
              errorMessage:
                preparationError?.version === deferred.version ? preparationError.message : null,
            });
          }

          clearUpdateState();
          return buildCheckResult({
            currentVersion,
            hasUpdate: false,
            readyToInstall: false,
          });
        }

        const info = result.updateInfo;
        const latestVersion = info.version;
        const hasUpdate = latestVersion !== currentVersion;

        if (hasUpdate) {
          cachedUpdateInfo = info;
          const errorMessage =
            preparationError?.version === latestVersion ? preparationError.message : null;
          if (!errorMessage) {
            preparationError = null;
          }
          return buildCheckResult({
            currentVersion,
            hasUpdate: true,
            readyToInstall: isReadyToInstallVersion(latestVersion),
            info,
            errorMessage,
          });
        }

        clearUpdateState();
        return buildCheckResult({
          currentVersion,
          hasUpdate: false,
          readyToInstall: false,
        });
      } catch (error) {
        deps.reportCheckError?.(error);
        return buildCheckResult({
          currentVersion,
          hasUpdate: false,
          readyToInstall: false,
          errorMessage: getErrorMessage(error),
        });
      }
    });
  }

  async function downloadAndInstallUpdate(
    {
      currentVersion,
      releaseChannel,
    }: {
      currentVersion: string;
      releaseChannel: AppReleaseChannel;
    },
    onBeforeQuit?: () => Promise<void>,
  ): Promise<AppUpdateInstallResult> {
    if (!deps.isPackaged()) {
      return {
        installed: false,
        outcome: "deferred",
        version: currentVersion,
        message: "Auto-update is not available in development mode.",
      };
    }

    const check = await checkForAppUpdate({
      currentVersion,
      releaseChannel,
      intent: "manual",
    });
    if (!check.hasUpdate) {
      return {
        installed: false,
        outcome: check.errorMessage ? "failed" : "deferred",
        version: currentVersion,
        message: check.errorMessage ?? "No update available.",
      };
    }

    return installCachedUpdate(currentVersion, { onBeforeQuit, restart: true });
  }

  async function ensureUpdateDownloaded(
    readyVersion: string,
    signal?: AbortSignal,
  ): Promise<"ready" | "aborted" | "superseded"> {
    while (!isReadyToInstallVersion(readyVersion)) {
      if (signal?.aborted) return "aborted";
      if (cachedUpdateInfo?.version !== readyVersion) return "superseded";

      const attemptedVersion: string = preparingUpdateVersion ?? readyVersion;
      preparingUpdateVersion ??= readyVersion;
      try {
        await deps.runtime.downloadUpdate();
      } catch (error) {
        if (
          attemptedVersion !== readyVersion &&
          cachedUpdateInfo?.version === readyVersion &&
          !signal?.aborted
        ) {
          continue;
        }
        throw error;
      }

      // electron-updater can return an older, already-running download. Its
      // event clears that version, then the next iteration starts the newly
      // validated release instead of treating the stale artifact as ready.
      if (attemptedVersion === readyVersion && !isReadyToInstallVersion(readyVersion)) {
        downloadedUpdateVersion = readyVersion;
        preparingUpdateVersion = null;
      }
    }

    return signal?.aborted ? "aborted" : "ready";
  }

  async function installCachedUpdate(
    currentVersion: string,
    {
      onBeforeQuit,
      signal,
      restart,
    }: {
      onBeforeQuit?: () => Promise<void>;
      signal?: AbortSignal;
      restart: boolean;
    },
  ): Promise<AppUpdateInstallResult> {
    if (!cachedUpdateInfo) {
      return {
        installed: false,
        outcome: "deferred",
        version: currentVersion,
        message: "No update available. Check for updates first.",
      };
    }

    const readyVersion = cachedUpdateInfo.version;
    if (signal?.aborted) {
      return buildDeferredInstallResult(currentVersion);
    }

    if (isReadyToInstallVersion(readyVersion)) {
      await performQuitAndInstall(deps.runtime, { onBeforeQuit, restart });
      return {
        installed: true,
        outcome: "installed",
        version: readyVersion,
        message: "Update downloaded. The app will restart shortly.",
      };
    }

    try {
      const preparation = await ensureUpdateDownloaded(readyVersion, signal);
      if (preparation === "aborted") {
        return buildDeferredInstallResult(currentVersion);
      }
      if (preparation === "superseded") {
        return {
          installed: false,
          outcome: "deferred",
          version: currentVersion,
          message: "A newer update was found and will be installed later.",
        };
      }
      await performQuitAndInstall(deps.runtime, { onBeforeQuit, restart });

      return {
        installed: true,
        outcome: "installed",
        version: readyVersion,
        message: "Update downloaded. The app will restart shortly.",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.reportInstallError?.(message);
      return {
        installed: false,
        outcome: "failed",
        version: currentVersion,
        message: `Update failed: ${message}`,
      };
    }
  }

  async function installUpdateOnQuit({
    currentVersion,
    releaseChannel,
    signal,
  }: {
    currentVersion: string;
    releaseChannel: AppReleaseChannel;
    signal: AbortSignal;
  }): Promise<boolean> {
    if (!deps.isPackaged() || !downloadedUpdateVersion) {
      return false;
    }

    const check = await checkForAppUpdate({
      currentVersion,
      releaseChannel,
      intent: "automatic",
    });
    if (signal.aborted || !check.hasUpdate) {
      return false;
    }

    const result = await installCachedUpdate(currentVersion, { signal, restart: false });
    return result.installed;
  }

  return {
    checkForAppUpdate,
    downloadAndInstallUpdate,
    installUpdateOnQuit,
  };
}
