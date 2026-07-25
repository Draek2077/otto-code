// POSIX-only: path/URI conversion is platform-dependent, so the Windows cases
// live in uri.test.ts and these run everywhere else.
import { describe, expect, it } from "vitest";
import { documentKey, fromFileUri, toFileUri } from "./uri.js";
import { isPlatform } from "../../test-utils/platform.js";

describe.skipIf(isPlatform("win32"))("file URI conversion on POSIX", () => {
  const cases: readonly string[] = [
    "/home/phili/a.ts",
    "/home/dir with space/b.ts",
    "/home/uni/café.ts",
    "/home/a/b#c.ts",
  ];

  it.each(cases)("round-trips %s", (filePath) => {
    expect(fromFileUri(toFileUri(filePath))).toBe(filePath);
  });

  it("percent-encodes spaces and reserved characters", () => {
    expect(toFileUri("/home/dir with space/b#c.ts")).toBe(
      "file:///home/dir%20with%20space/b%23c.ts",
    );
  });

  it("keys a path and its uri identically", () => {
    expect(documentKey("/a/b.ts")).toBe(documentKey("file:///a/b.ts"));
  });

  it("keeps path case, since the filesystem is case-sensitive", () => {
    expect(documentKey("/a/B.ts")).not.toBe(documentKey("/a/b.ts"));
  });
});
