import { describe, expect, it } from "vitest";
import { buildRefineDiff } from "./hunks";
import {
  allRefineSetKeys,
  applyRefineSet,
  countRefineSetChanges,
  keptHunkIdsFor,
  refineDecisionKey,
  splitAbsolutePath,
  type RefineFileProposal,
} from "./refine-set";

function proposal(id: string, base: string, next: string): RefineFileProposal {
  return {
    id,
    label: `${id}.md`,
    absolutePath: `/repo/${id}.md`,
    diff: buildRefineDiff(base, next),
  };
}

const INDEX = proposal("d0", "- one line\n- two line", "- one\n- two");
const ENTRY = proposal("d1", "detail", "detail\nmoved here");
const UNTOUCHED = proposal("d2", "same", "same");

const SET = [INDEX, ENTRY, UNTOUCHED];

describe("applyRefineSet", () => {
  it("keeping everything reproduces every proposal exactly", () => {
    const results = applyRefineSet(SET, allRefineSetKeys(SET));
    expect(results.map((file) => file.content)).toEqual([
      "- one\n- two",
      "detail\nmoved here",
      "same",
    ]);
  });

  it("keeping nothing reproduces every base exactly", () => {
    const results = applyRefineSet(SET, new Set());
    expect(results.map((file) => file.content)).toEqual([
      "- one line\n- two line",
      "detail",
      "same",
    ]);
  });

  // The decision key is what keeps two files' `h0` hunks apart. Without the
  // namespace, keeping one file's first change would silently keep every
  // file's first change — a cross-file write nobody asked for.
  it("scopes a decision to its own file", () => {
    const onlyIndex = new Set([refineDecisionKey("d0", "h0")]);
    const results = applyRefineSet(SET, onlyIndex);
    expect(results[0]).toMatchObject({ id: "d0", content: "- one\n- two", changed: true });
    expect(results[1]).toMatchObject({ id: "d1", content: "detail", changed: false });
  });

  /**
   * Accept skips unchanged files, so a file whose every change was dropped must
   * report `changed: false` — otherwise the session would write a byte-identical
   * file and leave the user unable to tell "kept nothing" from "wrote nothing".
   */
  it("marks a file unchanged when all of its hunks are dropped", () => {
    const results = applyRefineSet(SET, new Set([refineDecisionKey("d1", "h0")]));
    expect(results.map((file) => file.changed)).toEqual([false, true, false]);
  });

  it("marks a file the model did not touch as unchanged whatever is kept", () => {
    const results = applyRefineSet(SET, allRefineSetKeys(SET));
    expect(results[2]).toMatchObject({ id: "d2", changed: false });
  });
});

describe("keptHunkIdsFor", () => {
  it("returns only this file's hunk ids, unnamespaced", () => {
    const keys = new Set([refineDecisionKey("d0", "h0"), refineDecisionKey("d1", "h0")]);
    expect([...keptHunkIdsFor(INDEX, keys)]).toEqual(["h0"]);
    expect([...keptHunkIdsFor(UNTOUCHED, keys)]).toEqual([]);
  });
});

describe("countRefineSetChanges", () => {
  it("counts files that would actually be written, not files that were proposed", () => {
    expect(countRefineSetChanges(SET, allRefineSetKeys(SET))).toMatchObject({
      changedFiles: 2,
      proposedFiles: 2,
      keptHunks: 2,
      totalHunks: 2,
    });
    expect(countRefineSetChanges(SET, new Set())).toMatchObject({
      changedFiles: 0,
      proposedFiles: 2,
      keptHunks: 0,
      totalHunks: 2,
      additions: 0,
      removals: 0,
    });
  });

  it("sums line counts across files", () => {
    const stats = countRefineSetChanges(SET, allRefineSetKeys(SET));
    expect(stats.additions).toBe(3);
    expect(stats.removals).toBe(2);
  });

  it("returns zeroes for an empty set", () => {
    expect(countRefineSetChanges([], new Set())).toMatchObject({
      changedFiles: 0,
      proposedFiles: 0,
      totalHunks: 0,
    });
  });
});

describe("splitAbsolutePath", () => {
  // Context sets span the repo and the home directory, so each file is written
  // against its own directory rather than one workspace root.
  it("splits posix and windows paths the same way", () => {
    expect(splitAbsolutePath("/home/me/.claude/CLAUDE.md")).toEqual({
      dir: "/home/me/.claude",
      base: "CLAUDE.md",
    });
    expect(splitAbsolutePath("C:\\repo\\docs\\design.md")).toEqual({
      dir: "C:/repo/docs",
      base: "design.md",
    });
  });

  it("treats a bare filename as having no directory", () => {
    expect(splitAbsolutePath("CLAUDE.md")).toEqual({ dir: "", base: "CLAUDE.md" });
  });
});
