import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

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

describe("Zoom Recorder quit shutdown", () => {
  it("waits for the watcher to exit and leaves no status poll behind", async () => {
    vi.useFakeTimers();
    try {
      mocks.spawn.mockClear();
      const watcher = createWatcher();
      const taskkill = new EventEmitter();
      mocks.spawn.mockReturnValueOnce(watcher).mockImplementationOnce(() => {
        completeTaskkill(taskkill, watcher);
        return taskkill;
      });

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

  it("terminates the Windows bootstrap process tree", async () => {
    vi.useFakeTimers();
    try {
      mocks.spawn.mockClear();
      const watcher = createWatcher();
      const taskkill = new EventEmitter();
      mocks.spawn.mockReturnValueOnce(watcher).mockImplementationOnce(() => {
        completeTaskkill(taskkill, watcher);
        return taskkill;
      });

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
