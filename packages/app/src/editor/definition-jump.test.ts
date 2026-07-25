import { describe, expect, it } from "vitest";
import { planDefinitionJump } from "./definition-jump";

const WINDOWS_ROOT = "C:\\Users\\me\\repo";
const POSIX_ROOT = "/Users/me/repo";

describe("planDefinitionJump", () => {
  it("moves the caret when the ctags index answers with this file's relative path", () => {
    expect(
      planDefinitionJump({
        target: { path: "src/app.ts", line: 42 },
        openPath: "src/app.ts",
        workspaceRoot: POSIX_ROOT,
      }),
    ).toEqual({ kind: "in-file", line: 42 });
  });

  it("moves the caret when a language server answers with this file's absolute path", () => {
    expect(
      planDefinitionJump({
        target: { path: "/Users/me/repo/src/app.ts", line: 42 },
        openPath: "src/app.ts",
        workspaceRoot: POSIX_ROOT,
      }),
    ).toEqual({ kind: "in-file", line: 42 });
  });

  it("moves the caret for a Windows native path answering for the open relative file", () => {
    expect(
      planDefinitionJump({
        target: { path: "C:\\Users\\me\\repo\\src\\app.ts", line: 7 },
        openPath: "src/app.ts",
        workspaceRoot: WINDOWS_ROOT,
      }),
    ).toEqual({ kind: "in-file", line: 7 });
  });

  it("ignores drive-letter case on Windows", () => {
    expect(
      planDefinitionJump({
        target: { path: "c:\\users\\me\\repo\\src\\app.ts", line: 3 },
        openPath: "C:\\Users\\me\\repo\\src\\app.ts",
        workspaceRoot: WINDOWS_ROOT,
      }),
    ).toEqual({ kind: "in-file", line: 3 });
  });

  it("opens another file in the workspace by its relative path", () => {
    expect(
      planDefinitionJump({
        target: { path: "/Users/me/repo/src/other.ts", line: 12 },
        openPath: "src/app.ts",
        workspaceRoot: POSIX_ROOT,
      }),
    ).toEqual({ kind: "open", target: { path: "src/other.ts", line: 12 } });
  });

  it("keeps the absolute path for a definition outside the workspace", () => {
    expect(
      planDefinitionJump({
        target: { path: "/Users/me/other-repo/src/lib.ts", line: 5 },
        openPath: "src/app.ts",
        workspaceRoot: POSIX_ROOT,
      }),
    ).toEqual({ kind: "open", target: { path: "/Users/me/other-repo/src/lib.ts", line: 5 } });
  });

  it("keeps a path it cannot anchor exactly as it arrived", () => {
    expect(
      planDefinitionJump({
        target: { path: "~/notes.ts", line: 2 },
        openPath: "src/app.ts",
        workspaceRoot: POSIX_ROOT,
      }),
    ).toEqual({ kind: "open", target: { path: "~/notes.ts", line: 2 } });
  });
});
