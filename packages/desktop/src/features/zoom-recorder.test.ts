import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  app: {
    isPackaged: false,
    getAppPath: () => "C:\\otto\\desktop",
    getPath: () => "C:\\otto\\user-data",
  },
  getAllWindows: vi.fn(() => []),
  handle: vi.fn(),
  spawn: vi.fn(),
  log: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("electron", () => ({
  app: mocks.app,
  BrowserWindow: { getAllWindows: mocks.getAllWindows },
  ipcMain: { handle: mocks.handle },
}));

vi.mock("electron-log/main", () => ({ default: mocks.log }));

vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));

vi.mock("node:fs", () => ({
  existsSync: () => true,
  promises: {
    readdir: vi.fn(async () => []),
    readFile: vi.fn(async () => {
      throw new Error("status has not been written yet");
    }),
  },
}));

import { enableZoomRecorder, shutdownZoomRecorderForQuit } from "./zoom-recorder";

function emitWatcherExit(watcher: EventEmitter & { exitCode: number | null }): void {
  queueMicrotask(() => {
    watcher.exitCode = 0;
    watcher.emit("exit", 0, null);
  });
}

function completeTaskkill(
  taskkill: EventEmitter,
  watcher: EventEmitter & { exitCode: number | null },
): void {
  queueMicrotask(() => {
    emitWatcherExit(watcher);
    taskkill.emit("exit", 0, null);
  });
}

function createWatcher(): EventEmitter & {
  killed: boolean;
  exitCode: number | null;
  kill: () => boolean;
} {
  const watcher = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    killed: false,
    pid: 1234,
    signalCode: null,
    stderr: new EventEmitter(),
    stdout: new EventEmitter(),
  });
  const kill = vi.fn(() => {
    watcher.killed = true;
    emitWatcherExit(watcher);
    return true;
  });
  return Object.assign(watcher, { kill });
}

/** Queues the watcher spawn and the taskkill spawn that the Windows shutdown path makes. */
function primeSpawnForWindowsShutdown(): ReturnType<typeof createWatcher> {
  const watcher = createWatcher();
  const taskkill = new EventEmitter();
  mocks.spawn.mockReturnValueOnce(watcher).mockImplementationOnce(() => {
    completeTaskkill(taskkill, watcher);
    return taskkill;
  });
  return watcher;
}

/**
 * stopProcess() branches on process.platform, so a suite that leaves the platform
 * alone asserts whatever the machine happens to be. That is how this suite passed
 * on Windows and failed on the Linux CI runner. Pin the platform per test.
 */
async function withPlatform(platform: NodeJS.Platform, run: () => Promise<void>): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    await run();
  } finally {
    if (original) {
      Object.defineProperty(process, "platform", original);
    }
  }
}

describe("Zoom Recorder quit shutdown", () => {
  beforeEach(() => {
    // mockClear() keeps queued *Once implementations, so an unconsumed taskkill
    // stub from a previous test would be handed to the next enableZoomRecorder()
    // as its watcher. mockReset() drops the queue with the call record.
    mocks.spawn.mockReset();
  });

  it("waits for the watcher to exit and leaves no status poll behind", async () => {
    await withPlatform("win32", async () => {
      vi.useFakeTimers();
      try {
        const watcher = primeSpawnForWindowsShutdown();

        await enableZoomRecorder();
        expect(mocks.spawn).toHaveBeenCalledTimes(1);

        const shutdown = shutdownZoomRecorderForQuit();
        await vi.runAllTimersAsync();
        await shutdown;

        expect(watcher.kill).not.toHaveBeenCalled();
        expect(watcher.exitCode).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("terminates the Windows bootstrap process tree", async () => {
    await withPlatform("win32", async () => {
      vi.useFakeTimers();
      try {
        const watcher = primeSpawnForWindowsShutdown();

        await enableZoomRecorder();

        const shutdown = shutdownZoomRecorderForQuit();
        await vi.runAllTimersAsync();
        await shutdown;

        expect(watcher.kill).not.toHaveBeenCalled();
        expect(mocks.spawn).toHaveBeenNthCalledWith(
          2,
          "taskkill",
          ["/pid", "1234", "/t", "/f"],
          expect.objectContaining({ stdio: "ignore", windowsHide: true }),
        );
        expect(watcher.exitCode).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("signals the helper directly on POSIX instead of shelling out to taskkill", async () => {
    await withPlatform("linux", async () => {
      vi.useFakeTimers();
      try {
        const watcher = createWatcher();
        mocks.spawn.mockReturnValueOnce(watcher);

        await enableZoomRecorder();
        expect(mocks.spawn).toHaveBeenCalledTimes(1);

        const shutdown = shutdownZoomRecorderForQuit();
        await vi.runAllTimersAsync();
        await shutdown;

        // POSIX has no taskkill: the helper is signalled through the child handle.
        expect(watcher.kill).toHaveBeenCalled();
        expect(mocks.spawn).toHaveBeenCalledTimes(1);
        expect(watcher.exitCode).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
