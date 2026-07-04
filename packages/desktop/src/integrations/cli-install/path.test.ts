import { describe, expect, it } from "vitest";
import { resolveCliInstallSourcePath } from "./path";

describe("cli-install-path", () => {
  it("uses the bundled shim for packaged macOS installs", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "darwin",
        isPackaged: true,
        executablePath: "/Applications/Otto.app/Contents/MacOS/Otto",
        shimPath: "/Applications/Otto.app/Contents/Resources/bin/otto",
      }),
    ).toBe("/Applications/Otto.app/Contents/Resources/bin/otto");
  });

  it("prefers the original AppImage path on linux", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: true,
        executablePath: "/tmp/.mount_otto123/otto",
        shimPath: "/tmp/.mount_otto123/resources/bin/otto",
        appImagePath: "/home/user/Applications/Otto.AppImage",
      }),
    ).toBe("/home/user/Applications/Otto.AppImage");
  });

  it("falls back to the shim on windows and in development", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "win32",
        isPackaged: true,
        executablePath: "C:\\Users\\user\\AppData\\Local\\Programs\\Otto\\Otto.exe",
        shimPath: "C:\\Users\\user\\AppData\\Local\\Programs\\Otto\\resources\\bin\\otto.cmd",
      }),
    ).toBe("C:\\Users\\user\\AppData\\Local\\Programs\\Otto\\resources\\bin\\otto.cmd");

    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: false,
        executablePath: "/opt/Otto/otto",
        shimPath: "/opt/Otto/resources/bin/otto",
      }),
    ).toBe("/opt/Otto/resources/bin/otto");
  });
});
