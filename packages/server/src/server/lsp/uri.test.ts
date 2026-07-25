import { describe, expect, it } from "vitest";
import { documentKey, fromFileUri, NotAFileUriError, RelativePathError, toFileUri } from "./uri.js";
import { isPlatform } from "../../test-utils/platform.js";

describe("file URI conversion", () => {
  it("rejects a non-file scheme", () => {
    expect(() => fromFileUri("untitled:Untitled-1")).toThrow(NotAFileUriError);
    expect(() => fromFileUri("https://example.com/a.ts")).toThrow(NotAFileUriError);
  });

  it("carries the offending uri on the error", () => {
    try {
      fromFileUri("untitled:Untitled-1");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(NotAFileUriError);
      expect((error as NotAFileUriError).uri).toBe("untitled:Untitled-1");
    }
  });

  it("rejects a relative path", () => {
    expect(() => toFileUri("src/a.ts")).toThrow(RelativePathError);
  });
});

describe.skipIf(!isPlatform("win32"))("file URI conversion on Windows", () => {
  const cases: readonly string[] = [
    "C:\\Users\\phili\\a.ts",
    "C:\\dir with space\\b.ts",
    "C:\\uni\\café.ts",
    "C:\\a\\b#c.ts",
    "\\\\wsl$\\Ubuntu\\home\\p\\a.ts",
    "\\\\server\\share\\c.ts",
  ];

  it.each(cases)("round-trips %s", (filePath) => {
    expect(fromFileUri(toFileUri(filePath))).toBe(filePath);
  });

  it("emits a drive letter as a bare colon", () => {
    expect(toFileUri("C:\\a\\b.ts")).toBe("file:///C:/a/b.ts");
  });

  it("percent-encodes spaces and reserved characters", () => {
    expect(toFileUri("C:\\dir with space\\b#c.ts")).toBe("file:///C:/dir%20with%20space/b%23c.ts");
  });

  it("accepts a percent-encoded drive colon from a server", () => {
    expect(fromFileUri("file:///c%3A/a/b.ts")).toBe("c:\\a\\b.ts");
  });

  it("keys the drive-colon and bare-colon spellings identically", () => {
    expect(documentKey("file:///c%3A/a/b.ts")).toBe(documentKey("file:///C:/a/b.ts"));
  });

  it("keys a path and its uri identically", () => {
    expect(documentKey("C:\\a\\b.ts")).toBe(documentKey("file:///C:/a/b.ts"));
  });

  it("keys drive-letter case insensitively", () => {
    expect(documentKey("c:\\a\\b.ts")).toBe(documentKey("C:\\a\\b.ts"));
  });

  it("keys a UNC path stably", () => {
    expect(documentKey("\\\\wsl$\\Ubuntu\\home\\p\\a.ts")).toBe(
      documentKey("file://wsl$/Ubuntu/home/p/a.ts"),
    );
  });
});

describe("document keys", () => {
  it("is idempotent", () => {
    const key = documentKey(toFileUri(isPlatform("win32") ? "C:\\a\\b.ts" : "/a/b.ts"));
    expect(documentKey(key)).toBe(key);
  });

  it("does not collide across distinct files", () => {
    const root = isPlatform("win32") ? "C:\\a\\" : "/a/";
    expect(documentKey(`${root}b.ts`)).not.toBe(documentKey(`${root}c.ts`));
  });
});
