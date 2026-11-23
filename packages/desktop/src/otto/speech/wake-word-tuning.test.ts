import { describe, expect, it } from "vitest";

import { resolveWakeWordDetectorTuning } from "./wake-word-tuning.js";

describe("resolveWakeWordDetectorTuning", () => {
  it("strengthens both Sherpa controls as sensitivity increases", () => {
    const conservative = resolveWakeWordDetectorTuning(0);
    const defaultTuning = resolveWakeWordDetectorTuning(0.7);
    const sensitive = resolveWakeWordDetectorTuning(1);

    expect(defaultTuning.keywordsScore).toBeGreaterThan(conservative.keywordsScore);
    expect(defaultTuning.keywordsThreshold).toBeLessThan(conservative.keywordsThreshold);
    expect(sensitive.keywordsScore).toBe(3);
    expect(sensitive.keywordsThreshold).toBeCloseTo(0.1);
  });

  it("clamps invalid and out-of-range settings", () => {
    expect(resolveWakeWordDetectorTuning(-5)).toEqual(resolveWakeWordDetectorTuning(0));
    expect(resolveWakeWordDetectorTuning(5)).toEqual(resolveWakeWordDetectorTuning(1));
    expect(resolveWakeWordDetectorTuning(Number.NaN)).toEqual(resolveWakeWordDetectorTuning(0.7));
  });
});
