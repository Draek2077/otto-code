import type { DesktopSettingsStore } from "../settings/desktop-settings.js";

// Set as soon as 'before-quit' fires, before any window gets a chance to close.
// The tray's close-to-tray interception reads this to tell a real quit apart from
// the user just clicking the window's close button.
let appIsQuitting = false;

export function markAppQuitting(): void {
  appIsQuitting = true;
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
  stopDesktopManagedDaemonIfNeeded,
  onStopError,
}: {
  app: BeforeQuitApp;
  closeTransportSessions: () => void;
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

    void stopDesktopManagedDaemonIfNeeded()
      .catch((error) => {
        onStopError(error);
      })
      .finally(() => {
        app.exit(0);
      });
  };
}
