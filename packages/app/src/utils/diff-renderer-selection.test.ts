import { describe, expect, it } from "vitest";
import { selectDiffRenderer } from "./diff-renderer-selection";

describe("selectDiffRenderer", () => {
  it.each([
    [false, false, "legacy"],
    [false, true, "legacy"],
    [true, false, "legacy"],
    [true, true, "new"],
  ] as const)(
    "uses %s-enabled, %s-capable input to select %s",
    (isNewDiffEnabled, isNewDiffCapable, expected) => {
      expect(selectDiffRenderer({ isNewDiffEnabled, isNewDiffCapable })).toBe(expected);
    },
  );
});
