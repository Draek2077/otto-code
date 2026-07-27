import path from "node:path";
import { describe, expect, it } from "vitest";
import { prependEnvPath, resolveUnpackedLibDir } from "./sherpa-runtime-env.js";

// prependEnvPath joins with path.delimiter, which is ";" on Windows and ":"
// elsewhere. Build the expectations from it so these pass on CI too.
const D = path.delimiter;

describe("resolveUnpackedLibDir", () => {
  const PACKAGED_WIN =
    "C:\\Users\\phili\\AppData\\Local\\Programs\\Otto\\resources\\app.asar\\node_modules\\sherpa-onnx-win-x64";
  const UNPACKED_WIN =
    "C:\\Users\\phili\\AppData\\Local\\Programs\\Otto\\resources\\app.asar.unpacked\\node_modules\\sherpa-onnx-win-x64";

  it("redirects a path inside app.asar to its unpacked twin", () => {
    expect(resolveUnpackedLibDir(PACKAGED_WIN, (candidate) => candidate === UNPACKED_WIN)).toBe(
      UNPACKED_WIN,
    );
  });

  it("redirects posix-separated packaged paths too", () => {
    const packaged = "/Applications/Otto.app/Contents/Resources/app.asar/node_modules/sherpa";
    const unpacked =
      "/Applications/Otto.app/Contents/Resources/app.asar.unpacked/node_modules/sherpa";
    expect(resolveUnpackedLibDir(packaged, (candidate) => candidate === unpacked)).toBe(unpacked);
  });

  it("leaves a normal development path untouched", () => {
    const dev = "C:\\Users\\phili\\Projects\\otto-code\\node_modules\\sherpa-onnx-win-x64";
    expect(
      resolveUnpackedLibDir(dev, () => {
        throw new Error("existence must not be probed for a non-asar path");
      }),
    ).toBe(dev);
  });

  it("keeps the original path when nothing is unpacked", () => {
    // Better a useless PATH entry than one pointing at a directory that isn't
    // there — the caller still probes for the addon before using it.
    expect(resolveUnpackedLibDir(PACKAGED_WIN, () => false)).toBe(PACKAGED_WIN);
  });

  it("never leaves an app.asar path on PATH when the unpacked twin exists", () => {
    // The regression this guards: an `app.asar` entry on Windows PATH truncates
    // PATH for every `sh` child, which breaks git hooks in agent sessions.
    const resolved = resolveUnpackedLibDir(PACKAGED_WIN, () => true);
    expect(resolved).not.toMatch(/app\.asar[\\/]/);
  });
});

describe("prependEnvPath", () => {
  it("puts the lib dir first", () => {
    expect(prependEnvPath(`C:\\a${D}C:\\b`, "C:\\lib")).toBe(`C:\\lib${D}C:\\a${D}C:\\b`);
  });

  it("does not duplicate an entry that is already present", () => {
    expect(prependEnvPath(`C:\\lib${D}C:\\a`, "C:\\lib")).toBe(`C:\\lib${D}C:\\a`);
  });

  it("handles an empty starting value", () => {
    expect(prependEnvPath(undefined, "C:\\lib")).toBe("C:\\lib");
  });
});
