import { describe, expect, it } from "vitest";

import {
  advanceJobPercent,
  aggregatePullPercent,
  canRunAlongsideModelPull,
} from "./brain-ops-manager.js";

describe("advanceJobPercent", () => {
  it("keeps download progress monotonic when later output contains a lower percentage", () => {
    expect(advanceJobPercent(10, "  downloading: 5%\r")).toBe(10);
  });

  it("clamps a newly reported percentage to the job range", () => {
    expect(advanceJobPercent(null, "  downloading: 123%\r")).toBe(100);
  });
});

describe("aggregatePullPercent", () => {
  it("re-bases the bundle ring when a companion is queued during the primary download", () => {
    // A 10 GB quant halfway through becomes 5 / 12 GB when a 2 GB companion
    // joins its queue. The ring reflects the committed combined download.
    expect(aggregatePullPercent(0, 12, 10, 50)).toBe(41);
  });

  it("continues from completed primary bytes through a queued companion", () => {
    expect(aggregatePullPercent(10, 12, 2, 50)).toBe(91);
  });
});

describe("canRunAlongsideModelPull", () => {
  it("allows removal of an unused runtime while model files download", () => {
    expect(canRunAlongsideModelPull("runtime-remove")).toBe(true);
  });

  it("keeps runtime-consuming operations serialized with model downloads", () => {
    expect(canRunAlongsideModelPull("runtime-install")).toBe(false);
    expect(canRunAlongsideModelPull("calibrate")).toBe(false);
  });
});
