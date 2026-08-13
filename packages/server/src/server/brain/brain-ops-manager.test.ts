import { describe, expect, it } from "vitest";

import { advanceJobPercent } from "./brain-ops-manager.js";

describe("advanceJobPercent", () => {
  it("keeps download progress monotonic when later output contains a lower percentage", () => {
    expect(advanceJobPercent(10, "  downloading: 5%\r")).toBe(10);
  });

  it("clamps a newly reported percentage to the job range", () => {
    expect(advanceJobPercent(null, "  downloading: 123%\r")).toBe(100);
  });
});
