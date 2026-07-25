import { describe, expect, it } from "vitest";
import { selectReferencesWithinBudget } from "./refine-reference-budget";

describe("selectReferencesWithinBudget", () => {
  it("takes smallest first, so a budget buys the most files", () => {
    const chosen = selectReferencesWithinBudget(
      [
        { path: "big.md", bytes: 900 },
        { path: "small.md", bytes: 100 },
        { path: "medium.md", bytes: 300 },
      ],
      500,
    );
    expect(chosen).toEqual(["small.md", "medium.md"]);
  });

  // Stopping at the first file that does not fit would drop context for nothing:
  // a later, smaller file still has room.
  it("keeps going past a file that does not fit", () => {
    const chosen = selectReferencesWithinBudget(
      [
        { path: "tiny.md", bytes: 10 },
        { path: "huge.md", bytes: 10_000 },
        { path: "alsotiny.md", bytes: 20 },
      ],
      100,
    );
    expect(chosen).toEqual(["tiny.md", "alsotiny.md"]);
  });

  // Two rounds of the same session must see the same set, or their diffs are
  // not comparable.
  it("is stable for equal sizes by ordering on path", () => {
    const candidates = [
      { path: "b.md", bytes: 10 },
      { path: "a.md", bytes: 10 },
      { path: "c.md", bytes: 10 },
    ];
    expect(selectReferencesWithinBudget(candidates, 1000)).toEqual(["a.md", "b.md", "c.md"]);
    expect(selectReferencesWithinBudget(candidates.toReversed(), 1000)).toEqual([
      "a.md",
      "b.md",
      "c.md",
    ]);
  });

  it("caps the count even when everything would fit", () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      path: `f${String(index).padStart(2, "0")}.md`,
      bytes: 1,
    }));
    expect(selectReferencesWithinBudget(many, 10_000, 5)).toHaveLength(5);
  });

  it("ignores blank paths and treats a negative size as free", () => {
    expect(selectReferencesWithinBudget([{ path: "  ", bytes: 1 }], 100)).toEqual([]);
    expect(selectReferencesWithinBudget([{ path: "a.md", bytes: -5 }], 0)).toEqual(["a.md"]);
  });

  it("returns nothing for an empty candidate list or a zero budget", () => {
    expect(selectReferencesWithinBudget([], 100)).toEqual([]);
    expect(selectReferencesWithinBudget([{ path: "a.md", bytes: 10 }], 0)).toEqual([]);
  });
});
