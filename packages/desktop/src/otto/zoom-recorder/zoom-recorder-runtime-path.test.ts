import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveZoomRecorderRuntimePath } from "./zoom-recorder-runtime-path.js";

describe("resolveZoomRecorderRuntimePath", () => {
  it("uses an explicit helper override first", () => {
    expect(
      resolveZoomRecorderRuntimePath({
        configured: " ./custom-helper ",
        isPackaged: true,
        resourcesPath: path.join("release", "resources"),
        appPath: path.join("packages", "desktop"),
        platform: "win32",
      }),
    ).toBe(path.resolve("custom-helper"));
  });

  it("resolves the packaged Windows helper", () => {
    const resourcesPath = path.resolve("release", "resources");
    expect(
      resolveZoomRecorderRuntimePath({
        isPackaged: true,
        resourcesPath,
        appPath: path.resolve("packages", "desktop"),
        platform: "win32",
      }),
    ).toBe(path.join(resourcesPath, "zoom-recorder", "otto-zoom-recorder.exe"));
  });

  it("resolves the native x64 Linux helper output during development", () => {
    const appPath = path.resolve("packages", "desktop");
    expect(
      resolveZoomRecorderRuntimePath({
        isPackaged: false,
        resourcesPath: path.resolve("release", "resources"),
        appPath,
        platform: "linux",
      }),
    ).toBe(path.join(appPath, "resources", "zoom-recorder", "bin", "x64", "otto-zoom-recorder"));
  });
});
