import { describe, expect, it } from "vitest";
import { supportsZoomRecorder } from "./zoom-recorder-capability.js";

describe("supportsZoomRecorder", () => {
  it.each([
    [{ platform: "linux", arch: "x64" }, true],
    [{ platform: "win32", arch: "x64" }, true],
    [{ platform: "win32", arch: "arm64" }, false],
    [{ platform: "darwin", arch: "x64" }, false],
    [null, false],
  ])("returns %s for %j", (host, expected) => {
    expect(supportsZoomRecorder(host)).toBe(expected);
  });
});
