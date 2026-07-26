import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildDevShortcutDetails,
  decideAppUserModelId,
  DEV_APP_USER_MODEL_ID,
  DEV_SHORTCUT_FILE_NAME,
  RELEASE_APP_USER_MODEL_ID,
  resolveDevShortcutPath,
} from "./app-user-model-id";

describe("decideAppUserModelId", () => {
  it("claims no AUMID off Windows", () => {
    const writeDevShortcut = vi.fn(() => true);

    expect(
      decideAppUserModelId({
        platform: "darwin",
        isPackaged: false,
        skipDevShortcut: false,
        writeDevShortcut,
      }),
    ).toEqual({ appUserModelId: null, wroteDevShortcut: false });
    expect(writeDevShortcut).not.toHaveBeenCalled();
  });

  it("keeps the release AUMID when packaged, and never writes a shortcut", () => {
    // Must stay electron-builder's appId: NSIS stamps it onto the installed
    // Start Menu shortcut, which is how Windows resolves the sender.
    const writeDevShortcut = vi.fn(() => true);

    expect(
      decideAppUserModelId({
        platform: "win32",
        isPackaged: true,
        skipDevShortcut: false,
        writeDevShortcut,
      }),
    ).toEqual({ appUserModelId: RELEASE_APP_USER_MODEL_ID, wroteDevShortcut: false });
    expect(writeDevShortcut).not.toHaveBeenCalled();
  });

  it("claims the dev AUMID once its shortcut is registered", () => {
    expect(
      decideAppUserModelId({
        platform: "win32",
        isPackaged: false,
        skipDevShortcut: false,
        writeDevShortcut: () => true,
      }),
    ).toEqual({ appUserModelId: DEV_APP_USER_MODEL_ID, wroteDevShortcut: true });
  });

  it("falls back to the release AUMID when the shortcut cannot be written", () => {
    // An unregistered AUMID can stop Windows showing the toast at all, so
    // ambiguous-but-working beats distinguishable-but-silent.
    expect(
      decideAppUserModelId({
        platform: "win32",
        isPackaged: false,
        skipDevShortcut: false,
        writeDevShortcut: () => false,
      }),
    ).toEqual({ appUserModelId: RELEASE_APP_USER_MODEL_ID, wroteDevShortcut: false });
  });

  it("honors the opt-out without touching the Start Menu", () => {
    const writeDevShortcut = vi.fn(() => true);

    expect(
      decideAppUserModelId({
        platform: "win32",
        isPackaged: false,
        skipDevShortcut: true,
        writeDevShortcut,
      }),
    ).toEqual({ appUserModelId: RELEASE_APP_USER_MODEL_ID, wroteDevShortcut: false });
    expect(writeDevShortcut).not.toHaveBeenCalled();
  });
});

describe("resolveDevShortcutPath", () => {
  it("lands in the per-user Start Menu, not the machine-wide one", () => {
    expect(resolveDevShortcutPath(path.join("C:", "Users", "x", "AppData", "Roaming"))).toBe(
      path.join(
        "C:",
        "Users",
        "x",
        "AppData",
        "Roaming",
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs",
        DEV_SHORTCUT_FILE_NAME,
      ),
    );
  });
});

describe("buildDevShortcutDetails", () => {
  it("launches electron with the app directory and carries the dev AUMID", () => {
    const details = buildDevShortcutDetails({
      execPath: path.join("C:", "node_modules", "electron", "dist", "electron.exe"),
      appPath: path.join("C:", "repo", "packages", "desktop"),
      iconPath: path.join("C:", "repo", "packages", "desktop", "assets", "dev", "icon.ico"),
    });

    expect(details.target).toBe(
      path.join("C:", "node_modules", "electron", "dist", "electron.exe"),
    );
    // Quoted: the checkout path routinely contains spaces.
    expect(details.args).toBe(`"${path.join("C:", "repo", "packages", "desktop")}"`);
    expect(details.appUserModelId).toBe(DEV_APP_USER_MODEL_ID);
    expect(details.icon).toBe(
      path.join("C:", "repo", "packages", "desktop", "assets", "dev", "icon.ico"),
    );
    expect(details.iconIndex).toBe(0);
  });

  it("omits the icon entirely when none resolved, rather than passing an empty path", () => {
    const details = buildDevShortcutDetails({
      execPath: "electron.exe",
      appPath: "app",
      iconPath: null,
    });

    expect(details).not.toHaveProperty("icon");
    expect(details).not.toHaveProperty("iconIndex");
  });
});
