import { describe, expect, it } from "vitest";
import { computeVisibleTabActionKeys } from "./workspace-tab-actions-overflow";

const actions = [
  { key: "preview", width: 22 },
  { key: "artifacts", width: 28 },
  { key: "pin:draft", width: 22 },
  { key: "split-right", width: 22 },
  { key: "split-down", width: 22 },
] as const;

describe("computeVisibleTabActionKeys", () => {
  it("keeps every tool when everything fits", () => {
    const visible = computeVisibleTabActionKeys({ actions, availableWidth: 1000 });
    expect(visible).toEqual(
      new Set(["preview", "artifacts", "pin:draft", "split-right", "split-down"]),
    );
  });

  it("keeps nothing when not even the last tool fits", () => {
    const visible = computeVisibleTabActionKeys({ actions, availableWidth: 21 });
    expect(visible).toEqual(new Set());
  });

  it("collapses from the left: the kept tools are a suffix", () => {
    // 22 + 22 = 44 fits, adding pin:draft (22) would need 66.
    const visible = computeVisibleTabActionKeys({ actions, availableWidth: 50 });
    expect(visible).toEqual(new Set(["split-right", "split-down"]));
  });

  it("stops at the first tool that no longer fits even if earlier ones would", () => {
    // preview (22) is narrower than artifacts (28), but once artifacts fails
    // to fit, preview must collapse too — the visible set stays a suffix.
    const visible = computeVisibleTabActionKeys({ actions, availableWidth: 90 });
    expect(visible).toEqual(new Set(["pin:draft", "split-right", "split-down"]));
  });

  it("returns nothing for zero or negative available width", () => {
    expect(computeVisibleTabActionKeys({ actions, availableWidth: 0 })).toEqual(new Set());
    expect(computeVisibleTabActionKeys({ actions, availableWidth: -10 })).toEqual(new Set());
  });

  it("handles an empty tool list", () => {
    expect(computeVisibleTabActionKeys({ actions: [], availableWidth: 100 })).toEqual(new Set());
  });
});
