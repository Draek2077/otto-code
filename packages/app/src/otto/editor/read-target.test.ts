import { describe, expect, it } from "vitest";
import { resolveEditorReadTarget } from "./read-target";
describe("explicit external file scope", () => {
  it("uses an owning workspace where present and otherwise only the normalized parent directory", () => {
    expect(
      resolveEditorReadTarget({ path: "c:/REPO/src/main.ts", workspaceRoot: "C:/repo" }),
    ).toEqual({ cwd: "C:/repo", path: "c:/REPO/src/main.ts" });
    expect(
      resolveEditorReadTarget({ path: "/tmp/docs/../note.md", workspaceRoot: "/work/repo" }),
    ).toEqual({ cwd: "/tmp", path: "/tmp/note.md" });
    expect(
      resolveEditorReadTarget({ path: "D:\\notes\\note.md", workspaceRoot: "C:/repo" }),
    ).toEqual({ cwd: "D:/notes", path: "D:/notes/note.md" });
    expect(resolveEditorReadTarget({ path: "/note.md" })).toEqual({ cwd: "/", path: "/note.md" });
  });
});
