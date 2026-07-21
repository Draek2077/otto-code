import { describe, expect, it } from "vitest";
import type { DiffLine } from "@/utils/tool-call-parsers";
import { countDifferences } from "./diff-stats";

function lines(types: DiffLine["type"][]): DiffLine[] {
  return types.map((type) => ({ type, content: "" }));
}

describe("countDifferences", () => {
  it("counts a changed block once, not once per line", () => {
    // Five lines swapped for five others is one thing that changed, which is
    // what a reader stepping through the diff would count.
    expect(
      countDifferences(
        lines(["context", "remove", "remove", "remove", "add", "add", "add", "context"]),
      ),
    ).toBe(1);
  });

  it("counts blocks separated by context lines separately", () => {
    expect(countDifferences(lines(["context", "add", "context", "remove", "context"]))).toBe(2);
  });

  it("counts a block that opens the diff", () => {
    expect(countDifferences(lines(["add", "context"]))).toBe(1);
  });

  it("is zero for a diff with no changes", () => {
    expect(countDifferences(lines(["header", "context", "context"]))).toBe(0);
    expect(countDifferences([])).toBe(0);
  });

  // Hunk headers break a block: two hunks are two differences even when the
  // change type happens to run across the boundary.
  it("does not merge blocks across a hunk header", () => {
    expect(countDifferences(lines(["add", "header", "add"]))).toBe(2);
  });
});
