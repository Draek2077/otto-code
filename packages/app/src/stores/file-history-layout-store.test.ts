import { describe, expect, it } from "vitest";
import { DEFAULT_FILE_HISTORY_SIZES, normalizeFileHistorySizes } from "./file-history-layout-store";

describe("normalizeFileHistorySizes", () => {
  it("falls back to the default when nothing is stored", () => {
    expect(normalizeFileHistorySizes(undefined)).toEqual([...DEFAULT_FILE_HISTORY_SIZES]);
  });

  it("rejects a stored value with the wrong number of panes", () => {
    // A two-pane value is what a build from before the message pane existed
    // would have written; taking it literally would leave a pane unsized.
    expect(normalizeFileHistorySizes([0.5, 0.5])).toEqual([...DEFAULT_FILE_HISTORY_SIZES]);
  });

  it("renormalizes shares that do not sum to one", () => {
    const sizes = normalizeFileHistorySizes([2, 1, 1]);

    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1);
    expect(sizes[0]).toBeCloseTo(0.5);
  });

  it("keeps every pane visible", () => {
    const sizes = normalizeFileHistorySizes([0.98, 0.01, 0.01]);

    for (const size of sizes) {
      expect(size).toBeGreaterThan(0.05);
    }
  });

  it("survives a corrupted stored value", () => {
    const sizes = normalizeFileHistorySizes([Number.NaN, 0.5, 0.5]);

    expect(sizes.every((size) => Number.isFinite(size) && size > 0)).toBe(true);
  });
});
