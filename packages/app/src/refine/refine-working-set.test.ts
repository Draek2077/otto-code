import { describe, expect, it } from "vitest";
import { buildRefineLabel, buildRefineWorkingSet } from "./refine-working-set";

const ROOT = "/repos/otto-code";

describe("buildRefineLabel", () => {
  it("uses the workspace-relative path for a file inside the project", () => {
    expect(buildRefineLabel(`${ROOT}/docs/design.md`, ROOT)).toBe("docs/design.md");
  });

  it("home-shortens a global file rather than leaking a username", () => {
    const label = buildRefineLabel("/home/philippe/.claude/CLAUDE.md", ROOT);
    expect(label).toBe("~/.claude/CLAUDE.md");
    expect(label).not.toContain("philippe");
  });

  it("handles windows separators and a missing workspace root", () => {
    expect(buildRefineLabel("C:\\repos\\otto-code\\CLAUDE.md", "C:\\repos\\otto-code")).toBe(
      "CLAUDE.md",
    );
    expect(buildRefineLabel(`${ROOT}/CLAUDE.md`, null)).toBe(`${ROOT}/CLAUDE.md`);
  });

  it("does not treat a sibling directory with a shared prefix as inside the root", () => {
    expect(buildRefineLabel("/repos/otto-code-fork/CLAUDE.md", ROOT)).toBe(
      "/repos/otto-code-fork/CLAUDE.md",
    );
  });
});

describe("buildRefineWorkingSet", () => {
  it("mints positional ids and marks only the requested paths writable", () => {
    const set = buildRefineWorkingSet({
      paths: [`${ROOT}/CLAUDE.md`],
      references: [`${ROOT}/docs/design.md`],
      workspaceRoot: ROOT,
    });
    expect(set).toEqual([
      { id: "d0", absolutePath: `${ROOT}/CLAUDE.md`, label: "CLAUDE.md", writable: true },
      {
        id: "d1",
        absolutePath: `${ROOT}/docs/design.md`,
        label: "docs/design.md",
        writable: false,
      },
    ]);
  });

  it("keeps a repo file and a global file distinct without needing to disambiguate", () => {
    const set = buildRefineWorkingSet({
      paths: [`${ROOT}/CLAUDE.md`, "/home/me/.claude/CLAUDE.md"],
      workspaceRoot: ROOT,
    });
    expect(set.map((file) => file.label)).toEqual(["CLAUDE.md", "~/.claude/CLAUDE.md"]);
  });

  // The label is what the model uses to tell two documents apart, so two files
  // that render identically would make a multi-file rewrite guess. Home
  // shortening is the one place two different paths can collapse to one label.
  it("falls back to full paths when two files would render to the same label", () => {
    const set = buildRefineWorkingSet({
      paths: ["/home/me/notes.md", "/Users/me/notes.md"],
      workspaceRoot: ROOT,
    });
    expect(set.map((file) => file.label)).toEqual(["/home/me/notes.md", "/Users/me/notes.md"]);
    expect(new Set(set.map((file) => file.label)).size).toBe(2);
  });

  it("keeps a path rewritable when it is listed as both, rather than narrowing it", () => {
    const set = buildRefineWorkingSet({
      paths: [`${ROOT}/CLAUDE.md`],
      references: [`${ROOT}/CLAUDE.md`, `${ROOT}/MEMORY.md`],
      workspaceRoot: ROOT,
    });
    expect(set).toHaveLength(2);
    expect(set[0]).toMatchObject({ absolutePath: `${ROOT}/CLAUDE.md`, writable: true });
    expect(set[1]).toMatchObject({ absolutePath: `${ROOT}/MEMORY.md`, writable: false });
  });

  it("drops duplicates and blanks so ids stay stable and the set stays honest", () => {
    const set = buildRefineWorkingSet({
      paths: [`${ROOT}/a.md`, `${ROOT}/a.md`, "   "],
      workspaceRoot: ROOT,
    });
    expect(set.map((file) => file.id)).toEqual(["d0"]);
  });
});
