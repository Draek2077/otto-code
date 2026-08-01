import { describe, expect, it, vi } from "vitest";

import { DEFAULT_DESKTOP_SETTINGS } from "../settings/desktop-settings";
import {
  createQuitLifecycle,
  isAppQuitting,
  markAppQuitting,
  shouldStopDesktopManagedDaemonOnQuit,
  stopDesktopManagedDaemonOnQuitIfNeeded,
} from "./quit-lifecycle";

// Both fixtures state the flag outright rather than leaning on whatever
// DEFAULT_DESKTOP_SETTINGS currently holds — these assert the function's logic,
// and must not silently invert if the shipped default is ever flipped again.
const SETTINGS_KEEP_RUNNING = {
  ...DEFAULT_DESKTOP_SETTINGS,
  daemon: {
    ...DEFAULT_DESKTOP_SETTINGS.daemon,
    keepRunningAfterQuit: true,
  },
};
const SETTINGS_STOP_ON_QUIT = {
  ...DEFAULT_DESKTOP_SETTINGS,
  daemon: {
    ...DEFAULT_DESKTOP_SETTINGS.daemon,
    keepRunningAfterQuit: false,
  },
};

describe("quit-lifecycle", () => {
  it("stops the daemon unless the user opted into keeping it running", () => {
    expect(shouldStopDesktopManagedDaemonOnQuit(SETTINGS_STOP_ON_QUIT)).toBe(true);
    expect(shouldStopDesktopManagedDaemonOnQuit(SETTINGS_KEEP_RUNNING)).toBe(false);
  });

  it("ships with the daemon stopping on quit", () => {
    expect(shouldStopDesktopManagedDaemonOnQuit(DEFAULT_DESKTOP_SETTINGS)).toBe(true);
  });

  it("short-circuits without inspecting the daemon when keep-running is on", async () => {
    const isDesktopManagedDaemonRunning = vi.fn(() => true);
    const stopDaemon = vi.fn(async () => undefined);
    const showShutdownFeedback = vi.fn();

    const stopped = await stopDesktopManagedDaemonOnQuitIfNeeded({
      settingsStore: { get: async () => SETTINGS_KEEP_RUNNING },
      isDesktopManagedDaemonRunning,
      stopDaemon,
      showShutdownFeedback,
    });

    expect(stopped).toBe(false);
    expect(isDesktopManagedDaemonRunning).not.toHaveBeenCalled();
    expect(stopDaemon).not.toHaveBeenCalled();
    expect(showShutdownFeedback).not.toHaveBeenCalled();
  });

  it("does not stop a manually started daemon on quit", async () => {
    const stopDaemon = vi.fn(async () => undefined);
    const showShutdownFeedback = vi.fn();

    const stopped = await stopDesktopManagedDaemonOnQuitIfNeeded({
      settingsStore: { get: async () => SETTINGS_STOP_ON_QUIT },
      isDesktopManagedDaemonRunning: () => false,
      stopDaemon,
      showShutdownFeedback,
    });

    expect(stopped).toBe(false);
    expect(stopDaemon).not.toHaveBeenCalled();
    expect(showShutdownFeedback).not.toHaveBeenCalled();
  });

  it("shows feedback then stops a desktop-managed daemon", async () => {
    const stopDaemon = vi.fn(async () => undefined);
    const showShutdownFeedback = vi.fn();

    const stopped = await stopDesktopManagedDaemonOnQuitIfNeeded({
      settingsStore: { get: async () => SETTINGS_STOP_ON_QUIT },
      isDesktopManagedDaemonRunning: () => true,
      stopDaemon,
      showShutdownFeedback,
    });

    expect(stopped).toBe(true);
    expect(showShutdownFeedback).toHaveBeenCalledTimes(1);
    expect(stopDaemon).toHaveBeenCalledTimes(1);
    expect(showShutdownFeedback.mock.invocationCallOrder[0]).toBeLessThan(
      stopDaemon.mock.invocationCallOrder[0],
    );
  });

  // No update pending: the common case, and the one the pre-update behaviour
  // covered. Keeps these fixtures from having to spell it out each time.
  const NO_UPDATE = {
    installAppUpdateOnQuit: async () => false,
    createUpdateDeadlineSignal: () => AbortSignal.timeout(1_000),
    onUpdateError: () => undefined,
  };

  it("preventDefaults the first quit, runs the async stop decision, then exits hard", async () => {
    let resolveStopDecision: (() => void) | null = null;
    const app = { exit: vi.fn() };
    const closeTransportSessions = vi.fn();
    const onStopError = vi.fn();
    const preventDefault = vi.fn();
    const secondPreventDefault = vi.fn();

    const { handleBeforeQuit } = createQuitLifecycle({
      ...NO_UPDATE,
      app,
      closeTransportSessions,
      confirmQuitIfNeeded: vi.fn(async () => true),
      stopDesktopManagedDaemonIfNeeded: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveStopDecision = () => resolve(false);
          }),
      ),
      onStopError,
    });

    handleBeforeQuit({ preventDefault });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(closeTransportSessions).toHaveBeenCalledTimes(1);
    expect(app.exit).not.toHaveBeenCalled();

    // confirmQuitIfNeeded resolves asynchronously, so stopDesktopManagedDaemonIfNeeded
    // (and thus resolveStopDecision) isn't invoked until its microtask runs.
    await Promise.resolve();
    await Promise.resolve();
    expect(resolveStopDecision).not.toBeNull();

    resolveStopDecision?.();
    await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0));
    expect(onStopError).not.toHaveBeenCalled();

    handleBeforeQuit({ preventDefault: secondPreventDefault });

    expect(secondPreventDefault).not.toHaveBeenCalled();
    expect(closeTransportSessions).toHaveBeenCalledTimes(2);
    expect(app.exit).toHaveBeenCalledTimes(1);
  });

  it("aborts the quit when the renderer confirmation is declined", async () => {
    const app = { exit: vi.fn() };
    const closeTransportSessions = vi.fn();
    const onStopError = vi.fn();
    const preventDefault = vi.fn();
    const stopDesktopManagedDaemonIfNeeded = vi.fn(async () => false);

    const { handleBeforeQuit } = createQuitLifecycle({
      ...NO_UPDATE,
      app,
      closeTransportSessions,
      confirmQuitIfNeeded: vi.fn(async () => false),
      stopDesktopManagedDaemonIfNeeded,
      onStopError,
    });

    handleBeforeQuit({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);

    await Promise.resolve();
    await Promise.resolve();

    expect(stopDesktopManagedDaemonIfNeeded).not.toHaveBeenCalled();
    expect(app.exit).not.toHaveBeenCalled();

    // Cancelling resets the in-flight guard, so a later real quit attempt
    // still goes through the full preventDefault -> confirm -> exit sequence.
    const secondPreventDefault = vi.fn();
    handleBeforeQuit({ preventDefault: secondPreventDefault });
    expect(secondPreventDefault).toHaveBeenCalledTimes(1);
  });

  it("resets isAppQuitting when the renderer confirmation is declined", async () => {
    // main.ts's separate 'before-quit' listener always calls this first, before
    // the lifecycle's own listener runs in the same event cycle.
    markAppQuitting();
    expect(isAppQuitting()).toBe(true);

    const { handleBeforeQuit } = createQuitLifecycle({
      ...NO_UPDATE,
      app: { exit: vi.fn() },
      closeTransportSessions: vi.fn(),
      confirmQuitIfNeeded: vi.fn(async () => false),
      stopDesktopManagedDaemonIfNeeded: vi.fn(async () => false),
      onStopError: vi.fn(),
    });

    handleBeforeQuit({ preventDefault: vi.fn() });
    await Promise.resolve();
    await Promise.resolve();

    // A declined quit must not permanently wedge isAppQuitting() true - that
    // would disable close-to-tray (and the window-close quit confirmation) for
    // every later close in the same session, quitting outright without asking.
    expect(isAppQuitting()).toBe(false);
  });

  // autoInstallOnAppQuit is off, so an exit(0) here is a downloaded update that
  // never installs. This is the regression the merge introduced.
  it("hands the quit to the installer instead of exiting hard", async () => {
    const app = { exit: vi.fn() };
    const lifecycle = createQuitLifecycle({
      app,
      closeTransportSessions: vi.fn(),
      confirmQuitIfNeeded: vi.fn(async () => true),
      stopDesktopManagedDaemonIfNeeded: vi.fn(async () => false),
      installAppUpdateOnQuit: vi.fn(async () => true),
      createUpdateDeadlineSignal: () => AbortSignal.timeout(20),
      onStopError: vi.fn(),
      onUpdateError: vi.fn(),
    });

    lifecycle.handleBeforeQuit({ preventDefault: vi.fn() });
    lifecycle.handleBeforeQuitForUpdate();

    // Well past the deadline: the handoff has to suppress the hard exit
    // permanently, not just until the timeout fires.
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(app.exit).not.toHaveBeenCalled();
  });

  it("exits hard when the installer never takes over before the deadline", async () => {
    const app = { exit: vi.fn() };
    const { handleBeforeQuit } = createQuitLifecycle({
      app,
      closeTransportSessions: vi.fn(),
      confirmQuitIfNeeded: vi.fn(async () => true),
      stopDesktopManagedDaemonIfNeeded: vi.fn(async () => false),
      installAppUpdateOnQuit: vi.fn(async () => true),
      createUpdateDeadlineSignal: () => AbortSignal.timeout(20),
      onStopError: vi.fn(),
      onUpdateError: vi.fn(),
    });

    handleBeforeQuit({ preventDefault: vi.fn() });

    await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0));
  });

  it("still exits hard when the update revalidation throws", async () => {
    const app = { exit: vi.fn() };
    const onUpdateError = vi.fn();
    const { handleBeforeQuit } = createQuitLifecycle({
      app,
      closeTransportSessions: vi.fn(),
      confirmQuitIfNeeded: vi.fn(async () => true),
      stopDesktopManagedDaemonIfNeeded: vi.fn(async () => false),
      installAppUpdateOnQuit: vi.fn(async () => {
        throw new Error("manifest unreachable");
      }),
      createUpdateDeadlineSignal: () => AbortSignal.timeout(1_000),
      onStopError: vi.fn(),
      onUpdateError,
    });

    handleBeforeQuit({ preventDefault: vi.fn() });

    await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0));
    expect(onUpdateError).toHaveBeenCalledTimes(1);
  });
});
