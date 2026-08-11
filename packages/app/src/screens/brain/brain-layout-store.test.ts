import { describe, expect, it } from "vitest";
import {
  BRAIN_SPLIT_MAX_RATIO,
  BRAIN_SPLIT_MIN_RATIO,
  DEFAULT_BRAIN_SPLIT_RATIO,
  normalizeBrainSplitRatio,
} from "./brain-layout-store";

describe("normalizeBrainSplitRatio", () => {
  it("keeps a valid persisted split ratio", () => {
    expect(normalizeBrainSplitRatio(0.62)).toBe(0.62);
  });

  it("keeps either Brain pane within one quarter of the available space", () => {
    expect(normalizeBrainSplitRatio(0)).toBe(BRAIN_SPLIT_MIN_RATIO);
    expect(normalizeBrainSplitRatio(1)).toBe(BRAIN_SPLIT_MAX_RATIO);
  });

  it("repairs invalid persisted values to the balanced default", () => {
    expect(normalizeBrainSplitRatio(undefined)).toBe(DEFAULT_BRAIN_SPLIT_RATIO);
    expect(normalizeBrainSplitRatio(Number.NaN)).toBe(DEFAULT_BRAIN_SPLIT_RATIO);
  });
});
