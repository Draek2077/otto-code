import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { UUID } from "builder-util-runtime";
import { describe, expect, it, vi } from "vitest";
import { app, autoUpdater as electronAutoUpdater } from "electron";
import { DebUpdater } from "electron-updater";
import { installLinuxDeb } from "./linux-deb-installer";

const { autoUpdaterMock, logMock } = vi.hoisted(() => {
  const handlers = new Map<string, (value: unknown) => void>();
  return {
    autoUpdaterMock: {
      handlers,
      logger: {
        debug: vi.fn(),
        error: vi.fn((message: unknown) => console.error(message)),
        info: vi.fn(),
        warn: vi.fn(),
      },
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      on: vi.fn((event: string, handler: (value: unknown) => void) => {
        handlers.set(event, handler);
      }),
      quitAndInstall: vi.fn(),
    },
    logMock: {
      transports: { file: { getFile: () => ({ path: "/home/test/.config/Otto/logs/main.log" }) } },
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
  };
});

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(),
    isPackaged: true,
    relaunch: vi.fn(),
    quit: vi.fn(),
  },
  autoUpdater: { emit: vi.fn() },
}));

vi.mock("electron-updater", () => ({
  autoUpdater: autoUpdaterMock,
  DebUpdater: class {
    readonly packageType = "deb";
  },
}));

vi.mock("electron-log/main", () => ({ default: logMock }));
vi.mock("./linux-deb-installer", () => ({ installLinuxDeb: vi.fn() }));

import {
  bucketFromStagingUserId,
  checkForAppUpdate,
  downloadAndInstallUpdate,
  isLinuxDebUpdateInstalling,
  resolveStagingUserId,
  rolloutManifestSchema,
  shouldAdmitToRollout,
  shouldInstallAppUpdateOnQuit,
  shouldStopDesktopManagedDaemonBeforeAppUpdate,
} from "./auto-updater";

describe("checkForAppUpdate", () => {
  it("treats an unpublished channel manifest as an unavailable update", async () => {
    const error = Object.assign(new Error("Cannot find latest-mac.yml"), {
      code: "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND",
    });
    autoUpdaterMock.checkForUpdates.mockImplementationOnce(async () => {
      autoUpdaterMock.logger.error(error);
      autoUpdaterMock.handlers.get("error")?.(error);
      throw error;
    });

    const result = await checkForAppUpdate({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
      intent: "manual",
    });

    expect(result).toEqual({
      hasUpdate: false,
      readyToInstall: false,
      currentVersion: "1.2.3",
      latestVersion: "1.2.3",
      body: null,
      date: null,
      errorMessage: null,
    });
    expect(logMock.warn).toHaveBeenCalledWith(
      "[auto-updater] Update channel manifest is not published yet",
      error,
    );
  });

  it("writes genuine updater failures to the Electron main-process log once", async () => {
    const error = new Error("network down");
    autoUpdaterMock.checkForUpdates.mockImplementationOnce(async () => {
      autoUpdaterMock.logger.error(error);
      autoUpdaterMock.handlers.get("error")?.(error);
      throw error;
    });

    const result = await checkForAppUpdate({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
      intent: "manual",
    });

    expect(result.errorMessage).toBe("network down");
    expect(logMock.error).toHaveBeenCalledTimes(1);
    expect(logMock.error).toHaveBeenCalledWith(
      "[auto-updater] electron-updater reported an error",
      error,
    );
  });
});

describe("downloadAndInstallUpdate", () => {
  it("awaits Debian installation before daemon shutdown and restart, and stays usable on cancellation", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    const prototype = Object.getPrototypeOf(autoUpdaterMock);
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    Object.setPrototypeOf(autoUpdaterMock, DebUpdater.prototype);
    try {
      const info = { version: "1.2.4", downloadedFile: "/home/test/Otto update.deb" };
      const check = async () => {
        autoUpdaterMock.handlers.get("update-downloaded")?.(info);
        return { isUpdateAvailable: true, updateInfo: info };
      };
      autoUpdaterMock.checkForUpdates.mockImplementationOnce(check);
      vi.mocked(installLinuxDeb).mockRejectedValueOnce(new Error("Authorization was cancelled"));
      const beforeQuit = vi.fn(async () => undefined);
      const input = { currentVersion: "1.2.3", releaseChannel: "stable" as const };
      const failed = await downloadAndInstallUpdate(input, beforeQuit);
      expect(failed.outcome).toBe("failed");
      expect(failed.message).toContain("Authorization was cancelled");
      expect(beforeQuit).not.toHaveBeenCalled();
      expect(app.quit).not.toHaveBeenCalled();
      expect(app.relaunch).not.toHaveBeenCalled();
      expect(isLinuxDebUpdateInstalling()).toBe(false);

      let finishInstall!: () => void;
      vi.mocked(installLinuxDeb).mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishInstall = resolve;
          }),
      );
      autoUpdaterMock.checkForUpdates.mockImplementationOnce(check);
      const pending = downloadAndInstallUpdate(input, beforeQuit);
      await vi.waitFor(() => expect(isLinuxDebUpdateInstalling()).toBe(true));
      expect(app.quit).not.toHaveBeenCalled();
      expect(beforeQuit).not.toHaveBeenCalled();
      finishInstall();
      expect((await pending).outcome).toBe("installed");
      expect(beforeQuit).toHaveBeenCalledOnce();
      expect(app.relaunch).toHaveBeenCalledOnce();
      expect(electronAutoUpdater.emit).toHaveBeenCalledWith("before-quit-for-update");
      expect(app.quit).toHaveBeenCalledOnce();
      expect(isLinuxDebUpdateInstalling()).toBe(false);
      expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, "platform", platform);
      Object.setPrototypeOf(autoUpdaterMock, prototype);
    }
  });

  it.each([
    "Error executing command as another user: Not authorized",
    "dpkg: error: cannot access archive '/home/test/update.deb': No such file or directory",
    "dpkg: error: unable to access dpkg database directory: Permission denied",
  ])("returns installer stderr to the caller and permits a retry: %s", async (stderr) => {
    const info = { version: "1.2.4" };
    const check = async () => {
      autoUpdaterMock.handlers.get("update-available")?.(info);
      autoUpdaterMock.handlers.get("update-downloaded")?.(info);
      return { isUpdateAvailable: true, updateInfo: info };
    };
    autoUpdaterMock.checkForUpdates.mockImplementationOnce(check);
    autoUpdaterMock.quitAndInstall.mockImplementationOnce(() => {
      // Real BaseUpdater returns normally after emitting an install error.
      autoUpdaterMock.logger.error(stderr);
      autoUpdaterMock.handlers.get("error")?.(new Error("Command pkexec exited with code 1"));
    });

    const result = await downloadAndInstallUpdate({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
    });

    expect(result.installed).toBe(false);
    expect(result.outcome).toBe("failed");
    expect(result.message).toContain("Command pkexec exited with code 1");
    expect(result.message).toContain(stderr);
    expect(result.message).toContain("/home/test/.config/Otto/logs/main.log");

    autoUpdaterMock.checkForUpdates.mockImplementationOnce(check);
    const retry = await downloadAndInstallUpdate({
      currentVersion: "1.2.3",
      releaseChannel: "stable",
    });
    expect(retry.outcome).toBe("installed");
  });
});

describe("shouldInstallAppUpdateOnQuit", () => {
  it("keeps Linux AppImage updates on the manual install path", () => {
    expect(shouldInstallAppUpdateOnQuit({ platform: "linux", isAppImage: true })).toBe(false);
    expect(shouldInstallAppUpdateOnQuit({ platform: "linux", isAppImage: false })).toBe(true);
    expect(
      shouldInstallAppUpdateOnQuit({ platform: "linux", isAppImage: false, isDeb: true }),
    ).toBe(false);
    expect(shouldInstallAppUpdateOnQuit({ platform: "darwin", isAppImage: false })).toBe(true);
    expect(shouldInstallAppUpdateOnQuit({ platform: "win32", isAppImage: false })).toBe(true);
  });
});

describe("shouldStopDesktopManagedDaemonBeforeAppUpdate", () => {
  it("defers daemon shutdown until Linux package elevation succeeds", () => {
    expect(
      shouldStopDesktopManagedDaemonBeforeAppUpdate({ platform: "linux", isAppImage: false }),
    ).toBe(false);
    expect(
      shouldStopDesktopManagedDaemonBeforeAppUpdate({ platform: "linux", isAppImage: true }),
    ).toBe(true);
    expect(
      shouldStopDesktopManagedDaemonBeforeAppUpdate({ platform: "win32", isAppImage: false }),
    ).toBe(true);
  });
});

describe("shouldAdmitToRollout", () => {
  it("admits beta, missing rollout hours, zero-hour rollout, and missing release date", () => {
    expect(
      shouldAdmitToRollout({
        channel: "beta",
        rolloutHours: 24,
        releaseDate: "2026-04-28T00:00:00.000Z",
        now: Date.parse("2026-04-28T01:00:00.000Z"),
        bucket: 0.99,
      }),
    ).toBe(true);
    expect(
      shouldAdmitToRollout({
        channel: "stable",
        rolloutHours: undefined,
        releaseDate: "2026-04-28T00:00:00.000Z",
        now: Date.parse("2026-04-28T01:00:00.000Z"),
        bucket: 0.99,
      }),
    ).toBe(true);
    expect(
      shouldAdmitToRollout({
        channel: "stable",
        rolloutHours: 0,
        releaseDate: "2026-04-28T00:00:00.000Z",
        now: Date.parse("2026-04-28T01:00:00.000Z"),
        bucket: 0.99,
      }),
    ).toBe(true);
    expect(
      shouldAdmitToRollout({
        channel: "stable",
        rolloutHours: 24,
        releaseDate: undefined,
        now: Date.parse("2026-04-28T01:00:00.000Z"),
        bucket: 0.99,
      }),
    ).toBe(true);
  });

  it("blocks future releases and respects the linear threshold mid-rollout", () => {
    expect(
      shouldAdmitToRollout({
        channel: "stable",
        rolloutHours: 24,
        releaseDate: "2026-04-28T02:00:00.000Z",
        now: Date.parse("2026-04-28T01:00:00.000Z"),
        bucket: 0,
      }),
    ).toBe(false);
    expect(
      shouldAdmitToRollout({
        channel: "stable",
        rolloutHours: 24,
        releaseDate: "2026-04-28T00:00:00.000Z",
        now: Date.parse("2026-04-28T12:00:00.000Z"),
        bucket: 0.49,
      }),
    ).toBe(true);
    expect(
      shouldAdmitToRollout({
        channel: "stable",
        rolloutHours: 24,
        releaseDate: "2026-04-28T00:00:00.000Z",
        now: Date.parse("2026-04-28T12:00:00.000Z"),
        bucket: 0.51,
      }),
    ).toBe(false);
  });

  it("blocks the bucket-zero client at exact release time, admits as soon as time advances", () => {
    expect(
      shouldAdmitToRollout({
        channel: "stable",
        rolloutHours: 24,
        releaseDate: "2026-04-28T00:00:00.000Z",
        now: Date.parse("2026-04-28T00:00:00.000Z"),
        bucket: 0,
      }),
    ).toBe(false);
    expect(
      shouldAdmitToRollout({
        channel: "stable",
        rolloutHours: 24,
        releaseDate: "2026-04-28T00:00:00.000Z",
        now: Date.parse("2026-04-28T00:00:00.001Z"),
        bucket: 0,
      }),
    ).toBe(true);
  });

  it("admits the highest-bucket client at and past the rollout end", () => {
    const maxBucket = (0x100000000 - 1) / 0x100000000;
    expect(
      shouldAdmitToRollout({
        channel: "stable",
        rolloutHours: 24,
        releaseDate: "2026-04-28T00:00:00.000Z",
        now: Date.parse("2026-04-29T00:00:00.000Z"),
        bucket: maxBucket,
      }),
    ).toBe(true);
    expect(
      shouldAdmitToRollout({
        channel: "stable",
        rolloutHours: 24,
        releaseDate: "2026-04-28T00:00:00.000Z",
        now: Date.parse("2027-04-28T00:00:00.000Z"),
        bucket: maxBucket,
      }),
    ).toBe(true);
  });

  it("admits when releaseDate is unparseable", () => {
    expect(
      shouldAdmitToRollout({
        channel: "stable",
        rolloutHours: 24,
        releaseDate: "not a date",
        now: Date.parse("2026-04-28T12:00:00.000Z"),
        bucket: 0.99,
      }),
    ).toBe(true);
  });

  it("treats garbage manifest rollout fields as missing and admits", () => {
    const parsed = rolloutManifestSchema.parse({
      rolloutHours: "not a number",
      releaseDate: 12345,
    });

    expect(
      shouldAdmitToRollout({
        channel: "stable",
        rolloutHours: parsed.rolloutHours,
        releaseDate: parsed.releaseDate,
        now: Date.parse("2026-04-28T12:00:00.000Z"),
        bucket: 0.99,
      }),
    ).toBe(true);
  });

  it("maps the maximum 32-bit slot to a bucket strictly less than 1", () => {
    const allOnes = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    const allZeros = "00000000-0000-0000-0000-000000000000";
    expect(bucketFromStagingUserId(allOnes)).toBeLessThan(1);
    expect(bucketFromStagingUserId(allOnes)).toBeGreaterThan(0.999);
    expect(bucketFromStagingUserId(allZeros)).toBe(0);
  });

  it("creates and then reuses the on-disk staging user id", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "otto-updater-id-"));
    const filePath = path.join(tempDir, ".updaterId");

    try {
      const first = await resolveStagingUserId(filePath);
      const stored = (await readFile(filePath, "utf8")).trim();
      const second = await resolveStagingUserId(filePath);

      expect(UUID.check(stored)).toBeTruthy();
      expect(second).toBe(first);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
