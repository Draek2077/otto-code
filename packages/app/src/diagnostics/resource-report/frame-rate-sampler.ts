// Frame-timing accumulator for the resource monitor.
//
// Pure and driven by timestamps, so it is testable without a real frame loop:
// the monitor feeds it `requestAnimationFrame` timestamps and calls `flush()`
// once per census window.
//
// The distinction that matters for leak-hunting is *jank* (a frame that took
// too long because the JS thread was busy) versus a *stall* (the surface was
// hidden/suspended, so no frames were requested at all). A backgrounded window
// produces one enormous gap that would otherwise dominate every percentile and
// make an idle app look like the worst offender.

/** A frame slower than this is visibly dropped work on a 60Hz surface. */
export const LONG_FRAME_MS = 50;
/** A frame slower than this is below the 30fps "still feels smooth" floor. */
export const SLOW_FRAME_MS = 32;
/** A gap longer than this is a suspended surface, not jank. Excluded from stats. */
export const STALL_FRAME_MS = 1_000;

export interface FrameWindowStats {
  /** Frame deltas counted in this window (stalls excluded). */
  frames: number;
  /** Wall time covered by the counted deltas. */
  spanMs: number;
  fps: number;
  meanFrameMs: number;
  p95FrameMs: number;
  worstFrameMs: number;
  slowFrames: number;
  longFrames: number;
  /** longFrames / frames - 0 when no frames were counted. */
  jankRatio: number;
  /** Gaps over STALL_FRAME_MS: the surface was hidden or the process suspended. */
  stalls: number;
  stallMs: number;
}

export const EMPTY_FRAME_WINDOW_STATS: FrameWindowStats = {
  frames: 0,
  spanMs: 0,
  fps: 0,
  meanFrameMs: 0,
  p95FrameMs: 0,
  worstFrameMs: 0,
  slowFrames: 0,
  longFrames: 0,
  jankRatio: 0,
  stalls: 0,
  stallMs: 0,
};

export class FrameRateSampler {
  private lastTimestampMs: number | null = null;
  private deltas: number[] = [];
  private stalls = 0;
  private stallMs = 0;

  /**
   * Feed one frame timestamp. The first timestamp after construction or after a
   * flush only establishes the baseline - a delta needs two frames.
   */
  recordFrame(timestampMs: number): void {
    const previous = this.lastTimestampMs;
    this.lastTimestampMs = timestampMs;
    if (previous === null) {
      return;
    }
    const delta = timestampMs - previous;
    if (!Number.isFinite(delta) || delta <= 0) {
      return;
    }
    if (delta >= STALL_FRAME_MS) {
      this.stalls += 1;
      this.stallMs += delta;
      return;
    }
    this.deltas.push(delta);
  }

  /** Snapshot the window and start a fresh one. The frame baseline is kept. */
  flush(): FrameWindowStats {
    const stats = this.peek();
    this.deltas = [];
    this.stalls = 0;
    this.stallMs = 0;
    return stats;
  }

  peek(): FrameWindowStats {
    const { deltas, stalls, stallMs } = this;
    if (deltas.length === 0) {
      return { ...EMPTY_FRAME_WINDOW_STATS, stalls, stallMs };
    }

    const sorted = [...deltas].sort((left, right) => left - right);
    const spanMs = deltas.reduce((total, delta) => total + delta, 0);
    const frames = deltas.length;
    const meanFrameMs = spanMs / frames;
    const slowFrames = deltas.filter((delta) => delta > SLOW_FRAME_MS).length;
    const longFrames = deltas.filter((delta) => delta > LONG_FRAME_MS).length;

    return {
      frames,
      spanMs,
      fps: spanMs > 0 ? (frames * 1000) / spanMs : 0,
      meanFrameMs,
      p95FrameMs: percentile(sorted, 0.95),
      worstFrameMs: sorted[sorted.length - 1],
      slowFrames,
      longFrames,
      jankRatio: longFrames / frames,
      stalls,
      stallMs,
    };
  }
}

function percentile(sortedValues: number[], fraction: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * fraction) - 1);
  return sortedValues[Math.max(0, index)];
}
