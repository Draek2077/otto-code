import type { DesktopSettingsStore } from "../settings/desktop-settings.js";

// Set as soon as 'before-quit' fires, before any window gets a chance to close.
// The tray's close-to-tray interception reads this to tell a real quit apart from
// the user just clicking the window's close button.
let appIsQuitting = false;

export function markAppQuitting(): void {
  appIsQuitting = true;
}

// Called when a "warn before quitting" confirmation is cancelled, so a declined
// quit doesn't permanently wedge isAppQuitting() true for the rest of the
// process's life - which would otherwise disable close-to-tray and the
// close-handler's own quit confirmation for every later window close.
export function unmarkAppQuitting(): void {
  appIsQuitting = false;
}

export function isAppQuitting(): boolean {
  return appIsQuitting;
}

interface QuitLifecycleSettings {
  daemon: {
    keepRunningAfterQuit: boolean;
  };
}

interface BeforeQuitEvent {
  preventDefault(): void;
}

interface BeforeQuitApp {
  exit(code: number): void;
}

export interface StopOnQuitDeps {
  settingsStore: Pick<DesktopSettingsStore, "get">;
  isDesktopManagedDaemonRunning: () => boolean;
  stopDaemon: () => Promise<unknown>;
  showShutdownFeedback: () => void;
}

export function shouldStopDesktopManagedDaemonOnQuit(settings: QuitLifecycleSettings): boolean {
  return !settings.daemon.keepRunningAfterQuit;
}

export async function stopDesktopManagedDaemonOnQuitIfNeeded(
  deps: StopOnQuitDeps,
): Promise<boolean> {
  const settings = await deps.settingsStore.get();
  if (!shouldStopDesktopManagedDaemonOnQuit(settings)) {
    return false;
  }

  if (!deps.isDesktopManagedDaemonRunning()) {
    return false;
  }

  deps.showShutdownFeedback();
  await deps.stopDaemon();
  return true;
}

interface QuitLifecycle {
  handleBeforeQuit(event: BeforeQuitEvent): void;
  handleBeforeQuitForUpdate(): void;
}

interface DeferredUpdateQuit {
  promise: Promise<boolean>;
  resolve(): void;
}

function waitForUpdateDeadline(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(false), { once: true });
  });
}

function createDeferredUpdateQuit(): DeferredUpdateQuit {
  let resolvePromise!: (started: boolean) => void;
  const promise = new Promise<boolean>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: () => resolvePromise(true) };
}

export function createQuitLifecycle({
  app,
  closeTransportSessions,
  confirmQuitIfNeeded,
  stopDesktopManagedDaemonIfNeeded,
  installAppUpdateOnQuit,
  createUpdateDeadlineSignal,
  deferDaemonStopUntilUpdateHandoff = false,
  onStopError,
  onUpdateError,
}: {
  app: BeforeQuitApp;
  closeTransportSessions: () => void;
  // Resolves false to abort the quit (user cancelled a "warn before quitting"
  // confirmation). Resolves true when no confirmation was needed or the user
  // confirmed.
  confirmQuitIfNeeded: () => Promise<boolean>;
  stopDesktopManagedDaemonIfNeeded: () => Promise<boolean>;
  // Resolves true once a downloaded update has been revalidated and handed to
  // the installer, which re-fires the quit itself.
  installAppUpdateOnQuit: (signal: AbortSignal) => Promise<boolean>;
  createUpdateDeadlineSignal: () => AbortSignal;
  deferDaemonStopUntilUpdateHandoff?: boolean;
  onStopError: (error: unknown) => void;
  onUpdateError: (error: unknown) => void;
}): QuitLifecycle {
  // We always preventDefault on first quit so we can run the async stop
  // decision, then call app.exit(0) - which bypasses Electron's
  // close → window-all-closed → will-quit chain. The window-all-closed
  // listener is a darwin no-op (macOS convention) and would otherwise
  // veto a re-fired app.quit().
  //
  // The exception is a pending update. `autoInstallOnAppQuit` is off (see
  // features/auto-updater.ts - Otto revalidates the manifest rather than
  // installing a download a newer release has superseded), so the install only
  // happens if this runs it. Exiting hard before the installer has taken over
  // is what left downloaded updates permanently uninstalled.
  let quitting = false;
  let quittingForUpdate = false;
  const updateQuit = createDeferredUpdateQuit();

  function handleBeforeQuit(event: BeforeQuitEvent): void {
    closeTransportSessions();
    if (quittingForUpdate) return;
    if (quitting) {
      // MacUpdater's no-relaunch path calls app.quit() without emitting
      // before-quit-for-update. A second quit is equivalent handoff evidence.
      updateQuit.resolve();
      return;
    }
    quitting = true;
    event.preventDefault();

    void (async () => {
      // Never block quitting on a confirmation-plumbing failure.
      const confirmed = await confirmQuitIfNeeded().catch(() => true);
      if (!confirmed) {
        quitting = false;
        unmarkAppQuitting();
        return;
      }

      const signal = createUpdateDeadlineSignal();
      if (!deferDaemonStopUntilUpdateHandoff) {
        try {
          await stopDesktopManagedDaemonIfNeeded();
        } catch (error) {
          onStopError(error);
        }
      }
      const updateInstallation = installAppUpdateOnQuit(signal).catch((error) => {
        onUpdateError(error);
        return false;
      });
      const installingUpdate = await Promise.race([
        updateInstallation,
        waitForUpdateDeadline(signal),
      ]);
      if (installingUpdate) {
        const handoffStarted = await Promise.race([
          updateQuit.promise,
          waitForUpdateDeadline(createUpdateDeadlineSignal()),
        ]);
        if (handoffStarted) {
          return;
        }
      }

      if (deferDaemonStopUntilUpdateHandoff) {
        try {
          await stopDesktopManagedDaemonIfNeeded();
        } catch (error) {
          onStopError(error);
        }
      }

      app.exit(0);
    })();
  }

  return {
    handleBeforeQuit,
    handleBeforeQuitForUpdate() {
      quittingForUpdate = true;
      updateQuit.resolve();
    },
  };
}
