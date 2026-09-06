import { describe, expect, it } from "vitest";
import {
  DEFAULT_ARCHITECTURAL_VIEW_AUTHORING_SPLIT_SIZES,
  normalizeArchitecturalViewAuthoringSplitSizes,
} from "./architectural-view-authoring-layout-store";

describe("normalizeArchitecturalViewAuthoringSplitSizes", () => {
  it("restores the saved chat and preview percentages", () => {
    expect(normalizeArchitecturalViewAuthoringSplitSizes([0.63, 0.37])).toEqual([0.63, 0.37]);
  });

  it("falls back to the default for missing or obsolete layouts", () => {
    expect(normalizeArchitecturalViewAuthoringSplitSizes(undefined)).toEqual([
      ...DEFAULT_ARCHITECTURAL_VIEW_AUTHORING_SPLIT_SIZES,
    ]);
    expect(normalizeArchitecturalViewAuthoringSplitSizes([0.5, 0.25, 0.25])).toEqual([
      ...DEFAULT_ARCHITECTURAL_VIEW_AUTHORING_SPLIT_SIZES,
    ]);
  });

  it("keeps either pane available after repairing a corrupt saved size", () => {
    const sizes = normalizeArchitecturalViewAuthoringSplitSizes([0.99, Number.NaN]);

    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1);
    expect(sizes.every((size) => size >= 0.09)).toBe(true);
  });
});
