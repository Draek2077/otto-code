import { describe, expect, it } from "vitest";
import { metricSeverity } from "./metric-severity";

describe("metricSeverity", () => {
  it("scales heap thresholds from the available JS heap limit", () => {
    expect(metricSeverity("heap.usedBytes", 699, 1_000)).toBe("normal");
    expect(metricSeverity("heap.usedBytes", 700, 1_000)).toBe("warning");
    expect(metricSeverity("heap.usedBytes", 850, 1_000)).toBe("danger");
  });

  it("uses low-is-danger thresholds for frame rate", () => {
    expect(metricSeverity("frames.fps", 60)).toBe("normal");
    expect(metricSeverity("frames.fps", 45)).toBe("warning");
    expect(metricSeverity("frames.fps", 30)).toBe("danger");
  });

  it("leaves cumulative counters unclassified", () => {
    expect(metricSeverity("traffic.messages", 1_000_000)).toBe("normal");
  });
});
