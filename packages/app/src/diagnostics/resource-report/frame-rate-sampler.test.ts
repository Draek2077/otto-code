import { describe, expect, test } from "vitest";

import { FrameRateSampler, STALL_FRAME_MS } from "./frame-rate-sampler";

function feed(sampler: FrameRateSampler, deltas: number[], startAt = 0): void {
  let timestamp = startAt;
  sampler.recordFrame(timestamp);
  for (const delta of deltas) {
    timestamp += delta;
    sampler.recordFrame(timestamp);
  }
}

describe("FrameRateSampler", () => {
  test("reports 60fps for a steady 16.67ms frame train", () => {
    const sampler = new FrameRateSampler();
    feed(
      sampler,
      Array.from({ length: 60 }, () => 1000 / 60),
    );

    const stats = sampler.flush();

    expect(stats.frames).toBe(60);
    expect(stats.fps).toBeCloseTo(60, 5);
    expect(stats.longFrames).toBe(0);
    expect(stats.jankRatio).toBe(0);
  });

  test("counts frames over the jank thresholds", () => {
    const sampler = new FrameRateSampler();
    feed(sampler, [16, 16, 40, 16, 120, 16]);

    const stats = sampler.flush();

    // 40ms is slow but not long; 120ms is both.
    expect(stats.slowFrames).toBe(2);
    expect(stats.longFrames).toBe(1);
    expect(stats.worstFrameMs).toBe(120);
    expect(stats.jankRatio).toBeCloseTo(1 / 6, 5);
  });

  test("excludes suspended-surface gaps from the frame statistics", () => {
    const sampler = new FrameRateSampler();
    feed(sampler, [16, STALL_FRAME_MS + 5_000, 16]);

    const stats = sampler.flush();

    expect(stats.frames).toBe(2);
    expect(stats.stalls).toBe(1);
    expect(stats.stallMs).toBe(STALL_FRAME_MS + 5_000);
    // Without the exclusion the 6s gap would sink fps to ~0.5 and hide real jank.
    expect(stats.fps).toBeCloseTo(62.5, 1);
    expect(stats.worstFrameMs).toBe(16);
  });

  test("flush resets the window but keeps the frame baseline", () => {
    const sampler = new FrameRateSampler();
    feed(sampler, [16, 16]);
    expect(sampler.flush().frames).toBe(2);

    const empty = sampler.flush();
    expect(empty.frames).toBe(0);
    expect(empty.fps).toBe(0);

    sampler.recordFrame(1_000);
    // The baseline survived, so the very next frame yields a delta.
    sampler.recordFrame(1_016);
    expect(sampler.flush().frames).toBe(2);
  });

  test("ignores non-monotonic and non-finite timestamps", () => {
    const sampler = new FrameRateSampler();
    sampler.recordFrame(100);
    sampler.recordFrame(90);
    sampler.recordFrame(Number.NaN);

    expect(sampler.flush().frames).toBe(0);
  });
});
