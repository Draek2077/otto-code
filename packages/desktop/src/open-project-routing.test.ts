import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseOpenProjectPathFromArgv, parseOpenTargetFromArgv } from "./open-project-routing";

describe("open-project-routing", () => {
  it("returns a bare absolute path argument", () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), "otto-open-project-"));

    expect(
      parseOpenProjectPathFromArgv({
        argv: ["/Applications/Otto.app/Contents/MacOS/Otto", projectPath],
        isDefaultApp: false,
      }),
    ).toBe(projectPath);
  });

  it("finds a bare absolute path even when Chromium noise args appear first", () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), "otto-open-project-"));

    expect(
      parseOpenProjectPathFromArgv({
        argv: [
          "/Applications/Otto.app/Contents/MacOS/Otto",
          "--allow-file-access-from-files",
          "--no-sandbox",
          projectPath,
        ],
        isDefaultApp: false,
      }),
    ).toBe(projectPath);
  });

  it("does not treat flags as project paths", () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), "otto-open-project-"));
    const flagLikeDirectory = path.join(projectPath, "--version");
    mkdirSync(flagLikeDirectory);

    expect(
      parseOpenProjectPathFromArgv({
        argv: ["/Applications/Otto.app/Contents/MacOS/Otto", "--version", flagLikeDirectory],
        isDefaultApp: false,
      }),
    ).toBe(flagLikeDirectory);

    expect(
      parseOpenProjectPathFromArgv({
        argv: ["/Applications/Otto.app/Contents/MacOS/Otto", "--version"],
        isDefaultApp: false,
      }),
    ).toBeNull();
  });

  it("returns the path from an explicit --open-project flag for backward compatibility", () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), "otto-open-project-"));

    expect(
      parseOpenProjectPathFromArgv({
        argv: ["/Applications/Otto.app/Contents/MacOS/Otto", "--open-project", projectPath],
        isDefaultApp: false,
      }),
    ).toBe(projectPath);
  });

  // parseOpenProjectPathFromArgv doesn't recognize --open-with-otto and still
  // matches its directory argument as a bare positional path - it was never
  // taught to skip unknown flags' values. Callers (main.ts) MUST check
  // parseOpenTargetFromArgv first and only fall back to this function when it
  // returns null, so a --open-with-otto invocation is never double-handled.
  it("still matches --open-with-otto's directory as a bare positional (dispatch order matters)", () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), "otto-open-project-"));

    expect(
      parseOpenProjectPathFromArgv({
        argv: ["/Applications/Otto.app/Contents/MacOS/Otto", "--open-with-otto", projectPath],
        isDefaultApp: false,
      }),
    ).toBe(projectPath);
  });
});

describe("parseOpenTargetFromArgv", () => {
  it("returns a directory-shell target for --open-with-otto", () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), "otto-open-with-otto-"));

    expect(
      parseOpenTargetFromArgv({
        argv: ["/Applications/Otto.app/Contents/MacOS/Otto", "--open-with-otto", projectPath],
        isDefaultApp: false,
      }),
    ).toEqual({ kind: "directory-shell", path: projectPath });
  });

  it("returns null when --open-with-otto's path does not exist as a directory", () => {
    expect(
      parseOpenTargetFromArgv({
        argv: ["/Applications/Otto.app/Contents/MacOS/Otto", "--open-with-otto", "/does/not/exist"],
        isDefaultApp: false,
      }),
    ).toBeNull();
  });

  it("returns a file target for a bare existing file positional", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "otto-open-file-"));
    const filePath = path.join(dir, "example.ts");
    writeFileSync(filePath, "export const x = 1;\n");

    expect(
      parseOpenTargetFromArgv({
        argv: ["/Applications/Otto.app/Contents/MacOS/Otto", filePath],
        isDefaultApp: false,
      }),
    ).toEqual({ kind: "file", path: filePath });
  });

  it("does not treat --open-project's directory as a file target", () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), "otto-open-project-"));

    expect(
      parseOpenTargetFromArgv({
        argv: ["/Applications/Otto.app/Contents/MacOS/Otto", "--open-project", projectPath],
        isDefaultApp: false,
      }),
    ).toBeNull();
  });

  it("returns null when there is no matching flag or file argument", () => {
    expect(
      parseOpenTargetFromArgv({
        argv: ["/Applications/Otto.app/Contents/MacOS/Otto", "--no-sandbox"],
        isDefaultApp: false,
      }),
    ).toBeNull();
  });
});
