import { describe, expect, test } from "vitest";

import { analyzeResourceTrend, type ResourceSample } from "./resource-trend";

const MINUTE_MS = 60_000;

function series(metrics: Record<string, number[]>, stepMs = MINUTE_MS): ResourceSample[] {
  const length = Math.max(...Object.values(metrics).map((values) => values.length));
  return Array.from({ length }, (_, index) => ({
    at: 1_700_000_000_000 + index * stepMs,
    uptimeMs: index * stepMs,
    metrics: Object.fromEntries(
      Object.entries(metrics).map(([key, values]) => [key, values[index]]),
    ),
  }));
}

describe("analyzeResourceTrend", () => {
  test("ranks a monotonic climber above a metric that merely oscillates", () => {
    const samples = series({
      "query.queries": [100, 140, 190, 250, 320, 400],
      "layout.openTabs.size": [4, 7, 3, 8, 2, 5],
    });

    const report = analyzeResourceTrend(samples);

    expect(report.growing.map((metric) => metric.key)).toEqual(["query.queries"]);
    expect(report.growing[0].monotonicity).toBe(1);
    expect(report.growing[0].delta).toBe(300);
  });

  test("reports slope in units per hour", () => {
    // +60 per minute over 5 minutes is +3600 per hour.
    const samples = series({ "heap.usedBytes": [0, 60, 120, 180, 240, 300] });

    const report = analyzeResourceTrend(samples);

    expect(report.growing[0].slopePerHour).toBeCloseTo(3600, 3);
    expect(report.elapsedMs).toBe(5 * MINUTE_MS);
  });

  test("ranks by relative growth so units do not decide the winner", () => {
    // The byte counter has the far bigger absolute slope, but it grew by 10%
    // while the interval count tripled - the interval count is the real signal.
    const samples = series({
      "heap.usedBytes": [100_000_000, 102_500_000, 105_000_000, 107_500_000, 110_000_000],
      "runtime.liveIntervals": [10, 15, 20, 25, 30],
    });

    const report = analyzeResourceTrend(samples);

    expect(report.growing[0].key).toBe("runtime.liveIntervals");
  });

  test("excludes flat and shrinking metrics from the growing list", () => {
    const samples = series({
      "dom.nodes": [5000, 5000, 5000, 5000, 5000],
      "query.mutations": [40, 30, 20, 10, 0],
    });

    expect(analyzeResourceTrend(samples).growing).toEqual([]);
  });

  test("returns an empty analysis below the minimum sample count", () => {
    const report = analyzeResourceTrend(series({ "query.queries": [1, 2] }));

    expect(report.growing).toEqual([]);
    expect(report.all).toEqual([]);
    expect(report.samples).toBe(2);
  });

  test("tolerates a metric that only appears part-way through the session", () => {
    const samples = series({ "dom.nodes": [10, 20, 30, 40, 50] });
    delete (samples[0].metrics as Record<string, number>)["dom.nodes"];
    delete (samples[1].metrics as Record<string, number>)["dom.nodes"];

    const trend = analyzeResourceTrend(samples).all.find((m) => m.key === "dom.nodes");

    expect(trend?.samples).toBe(3);
    expect(trend?.first).toBe(30);
    expect(trend?.last).toBe(50);
  });
});
