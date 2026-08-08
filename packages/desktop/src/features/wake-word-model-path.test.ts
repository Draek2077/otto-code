import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWakeWordModelDir } from "./wake-word-model-path.js";

describe("resolveWakeWordModelDir", () => {
  it("uses an explicit model override first", () => {
    expect(
      resolveWakeWordModelDir({
        configured: " ./custom-wake-word ",
        isPackaged: true,
        resourcesPath: path.join("release", "resources"),
        appPath: path.join("packages", "desktop"),
      }),
    ).toBe(path.resolve("custom-wake-word"));
  });

  it("loads the model from packaged Electron resources", () => {
    const resourcesPath = path.resolve("release", "resources");
    expect(
      resolveWakeWordModelDir({
        isPackaged: true,
        resourcesPath,
        appPath: path.resolve("packages", "desktop"),
      }),
    ).toBe(path.join(resourcesPath, "wake-word"));
  });

  it("loads the checked-in shared model during development", () => {
    const appPath = path.resolve("packages", "desktop");
    expect(
      resolveWakeWordModelDir({
        isPackaged: false,
        resourcesPath: path.resolve("release", "resources"),
        appPath,
      }),
    ).toBe(path.resolve(appPath, "../expo-two-way-audio/models/wake-word"));
  });
});
