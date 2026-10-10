import { describe, expect, it } from "vitest";
import { isMissingFileError } from "@/editor/missing-file-error";

describe("isMissingFileError", () => {
  it("matches the filesystem's not-found error text", () => {
    expect(isMissingFileError("ENOENT: no such file or directory, open '/repo/docs/plan.md'")).toBe(
      true,
    );
    expect(isMissingFileError("Error: ENOENT: no such file or directory, realpath 'docs/x'")).toBe(
      true,
    );
  });

  it("does not treat other read failures as a file waiting to be created", () => {
    expect(isMissingFileError("EISDIR: illegal operation on a directory, read")).toBe(false);
    expect(isMissingFileError("EACCES: permission denied, open 'secret'")).toBe(false);
    expect(isMissingFileError("Failed to load file")).toBe(false);
    expect(isMissingFileError("XENOENTX")).toBe(false);
  });

  it("is false when there is no error", () => {
    expect(isMissingFileError(null)).toBe(false);
    expect(isMissingFileError(undefined)).toBe(false);
    expect(isMissingFileError("")).toBe(false);
  });
});
