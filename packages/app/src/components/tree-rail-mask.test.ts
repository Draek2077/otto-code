import { describe, expect, it } from "vitest";
import { TREE_RAILS_ALL_CONTINUE, treeRailContinuesAt, withTreeRail } from "./tree-rail-mask";

/**
 * Reads a row's mask back the way `TreeIndentGuides` does: one character per rail
 * column, where column `i` carries the rail of depth `i + 1`.
 *   "|" full-height rail   "L" last child, rail stops at the tick   " " branch already closed
 */
function railsFor(mask: number, depth: number): string {
  let out = "";
  for (let index = 0; index < depth; index += 1) {
    const railDepth = index + 1;
    if (treeRailContinuesAt(mask, railDepth)) {
      out += "|";
    } else {
      out += railDepth === depth ? "L" : " ";
    }
  }
  return out;
}

describe("tree rail mask", () => {
  it("keeps every rail full height by default", () => {
    expect(railsFor(TREE_RAILS_ALL_CONTINUE, 3)).toBe("|||");
  });

  it("draws no rails at depth 0", () => {
    expect(railsFor(TREE_RAILS_ALL_CONTINUE, 0)).toBe("");
  });

  it("closes off the last child of a group", () => {
    const notLast = withTreeRail(TREE_RAILS_ALL_CONTINUE, 1, true);
    const last = withTreeRail(TREE_RAILS_ALL_CONTINUE, 1, false);
    expect(railsFor(notLast, 1)).toBe("|");
    expect(railsFor(last, 1)).toBe("L");
  });

  it("blanks an ancestor column once that branch has closed", () => {
    // root
    // └─ a          (depth 1, last)
    //    ├─ b       (depth 2, not last) — column 0 is blank, not a running rail
    //    └─ c       (depth 2, last)
    const a = withTreeRail(TREE_RAILS_ALL_CONTINUE, 1, false);
    const b = withTreeRail(a, 2, true);
    const c = withTreeRail(a, 2, false);
    expect(railsFor(a, 1)).toBe("L");
    expect(railsFor(b, 2)).toBe(" |");
    expect(railsFor(c, 2)).toBe(" L");
  });

  it("keeps an ancestor rail running while that branch still has siblings", () => {
    // root
    // ├─ a          (depth 1, not last)
    // │  └─ b       (depth 2, last) — column 0 still runs, column 1 closes
    // └─ d
    const a = withTreeRail(TREE_RAILS_ALL_CONTINUE, 1, true);
    const b = withTreeRail(a, 2, false);
    expect(railsFor(b, 2)).toBe("|L");
  });

  it("re-opens a rail when a deeper subtree is re-entered", () => {
    // A closed bit must not leak into an unrelated sibling's subtree.
    const closed = withTreeRail(TREE_RAILS_ALL_CONTINUE, 2, false);
    const reopened = withTreeRail(closed, 2, true);
    expect(treeRailContinuesAt(reopened, 2)).toBe(true);
  });

  it("ignores depth 0 — those rows have no rail of their own", () => {
    expect(withTreeRail(TREE_RAILS_ALL_CONTINUE, 0, false)).toBe(TREE_RAILS_ALL_CONTINUE);
  });

  it("falls back to full rails past the tracked depth instead of wrapping the bit", () => {
    const absurd = withTreeRail(TREE_RAILS_ALL_CONTINUE, 40, false);
    expect(absurd).toBe(TREE_RAILS_ALL_CONTINUE);
    expect(treeRailContinuesAt(absurd, 40)).toBe(true);
  });
});
