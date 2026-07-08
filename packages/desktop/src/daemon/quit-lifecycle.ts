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
// process's life — which would otherwise disable close-to-tray and the
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

export function createBeforeQuitHandler({
  app,
  closeTransportSessions,
  confirmQuitIfNeeded,
  stopDesktopManagedDaemonIfNeeded,
  onStopError,
}: {
  app: BeforeQuitApp;
  closeTransportSessions: () => void;
  // Resolves false to abort the quit (user cancelled a "warn before quitting"
  // confirmation). Resolves true when no confirmation was needed or the user
  // confirmed.
  confirmQuitIfNeeded: () => Promise<boolean>;
  stopDesktopManagedDaemonIfNeeded: () => Promise<boolean>;
  onStopError: (error: unknown) => void;
}): (event: BeforeQuitEvent) => void {
  // We always preventDefault on first quit so we can run the async stop
  // decision, then call app.exit(0) — which bypasses Electron's
  // close → window-all-closed → will-quit chain. The window-all-closed
  // listener is a darwin no-op (macOS convention) and would otherwise
  // veto a re-fired app.quit().
  let quitting = false;

  return (event) => {
    closeTransportSessions();
    if (quitting) return;
    quitting = true;
    event.preventDefault();

    void confirmQuitIfNeeded()
      .catch(() => true) // never block quitting on a confirmation-plumbing failure
      .then((confirmed) => {
        if (!confirmed) {
          quitting = false;
          unmarkAppQuitting();
          return;
        }

        return stopDesktopManagedDaemonIfNeeded()
          .catch((error) => {
            onStopError(error);
          })
          .finally(() => {
            app.exit(0);
          });
      });
  };
}
