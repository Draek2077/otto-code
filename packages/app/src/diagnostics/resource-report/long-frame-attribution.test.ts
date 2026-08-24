import { describe, expect, test } from "vitest";

import {
  LONG_FRAME_AGGREGATE_CAPACITY,
  LONG_FRAME_RING_CAPACITY,
  LONG_FRAME_SCRIPTS_PER_ENTRY,
  LongFrameAggregator,
  summarizeLongAnimationFrame,
  type LongFrameSummary,
  type PerformanceLongAnimationFrameTiming,
} from "./long-frame-attribution";

function loafEntry(
  overrides: Partial<PerformanceLongAnimationFrameTiming> = {},
): PerformanceLongAnimationFrameTiming {
  return {
    name: "long-animation-frame",
    entryType: "long-animation-frame",
    startTime: 1_000,
    duration: 120,
    blockingDuration: 70,
    renderStart: 1_090,
    styleAndLayoutStart: 1_100,
    scripts: [],
    toJSON: () => ({}),
    ...overrides,
  } as PerformanceLongAnimationFrameTiming;
}

function script(
  overrides: Partial<NonNullable<PerformanceLongAnimationFrameTiming["scripts"]>[number]> & {
    duration: number;
  },
): NonNullable<PerformanceLongAnimationFrameTiming["scripts"]>[number] {
  return {
    name: "script",
    entryType: "script",
    startTime: 1_000,
    invoker: "IMG.onload",
    invokerType: "event-listener",
    sourceURL: "app://bundle.js",
    sourceFunctionName: "applyAgentUpdate",
    sourceCharPosition: 42,
    forcedStyleAndLayoutDuration: 0,
    toJSON: () => ({}),
    ...overrides,
  } as NonNullable<PerformanceLongAnimationFrameTiming["scripts"]>[number];
}

function summary(overrides: Partial<LongFrameSummary> = {}): LongFrameSummary {
  return {
    at: 1_000,
    durationMs: 80,
    blockingMs: 30,
    styleAndLayoutMs: 10,
    scripts: [],
    ...overrides,
  };
}

describe("summarizeLongAnimationFrame", () => {
  test("converts timestamps to epoch and computes the style+layout share", () => {
    const result = summarizeLongAnimationFrame(loafEntry(), 5_000);

    expect(result.at).toBe(6_000);
    expect(result.durationMs).toBe(120);
    expect(result.blockingMs).toBe(70);
    // frame end 1120 minus styleAndLayoutStart 1100.
    expect(result.styleAndLayoutMs).toBe(20);
  });

  test("keeps only the slowest scripts, ranked by duration", () => {
    const entry = loafEntry({
      scripts: Array.from({ length: LONG_FRAME_SCRIPTS_PER_ENTRY + 3 }, (_, index) =>
        script({ duration: index + 1, sourceFunctionName: `fn${index}` }),
      ),
    });

    const result = summarizeLongAnimationFrame(entry, 0);

    expect(result.scripts).toHaveLength(LONG_FRAME_SCRIPTS_PER_ENTRY);
    expect(result.scripts[0].source).toBe(`app://bundle.js@fn${LONG_FRAME_SCRIPTS_PER_ENTRY + 2}`);
    expect(result.scripts[0].durationMs).toBe(LONG_FRAME_SCRIPTS_PER_ENTRY + 3);
  });

  test("falls back to the invoker when the script has no source", () => {
    const entry = loafEntry({
      scripts: [script({ duration: 10, sourceURL: "", sourceFunctionName: "" })],
    });

    const result = summarizeLongAnimationFrame(entry, 0);

    expect(result.scripts[0].source).toBe("IMG.onload");
  });
});

describe("timer attribution", () => {
  test("names a timer-invoked script from the matching timer fire and keys the source on it", () => {
    const result = summarizeLongAnimationFrame(
      loafEntry({
        scripts: [
          script({
            duration: 180,
            startTime: 1_002,
            invoker: "TimerHandler:setTimeout",
            invokerType: "user-callback",
            sourceURL: "bundle",
            sourceFunctionName: "",
          }),
        ],
      }),
      0,
      (startedAtMs) =>
        startedAtMs === 1_002
          ? {
              kind: "timeout",
              delayMs: 0,
              name: "(anonymous)",
              source: "() => flush()",
              registeredAt: "    at flushPendingTranscript (bundle:12:3)",
            }
          : null,
    );
    expect(result.scripts[0].source).toBe("bundle@timer:(anonymous from flushPendingTranscript)");
    expect(result.scripts[0].timer).toMatchObject({ kind: "timeout", source: "() => flush()" });
  });

  test("leaves non-timer scripts and unmatched timers unnamed", () => {
    const result = summarizeLongAnimationFrame(
      loafEntry({
        scripts: [
          script({ duration: 80, sourceURL: "bundle", sourceFunctionName: "listener" }),
          script({
            duration: 60,
            invoker: "TimerHandler:setInterval",
            invokerType: "user-callback",
            sourceURL: "bundle",
            sourceFunctionName: "",
          }),
        ],
      }),
      0,
      () => null,
    );
    expect(result.scripts.map((entry) => entry.source)).toEqual(["bundle@listener", "bundle"]);
    expect(result.scripts.every((entry) => entry.timer === undefined)).toBe(true);
  });
});

describe("LongFrameAggregator", () => {
  test("aggregates script cost across frames and ranks by total time", () => {
    const aggregator = new LongFrameAggregator();
    aggregator.record(
      summary({
        scripts: [
          {
            source: "a",
            invokerType: "",
            invoker: "",
            durationMs: 10,
            forcedStyleAndLayoutMs: 0,
            charPosition: -1,
          },
        ],
      }),
    );
    aggregator.record(
      summary({
        scripts: [
          {
            source: "a",
            invokerType: "",
            invoker: "",
            durationMs: 30,
            forcedStyleAndLayoutMs: 0,
            charPosition: -1,
          },
          {
            source: "b",
            invokerType: "",
            invoker: "",
            durationMs: 25,
            forcedStyleAndLayoutMs: 0,
            charPosition: -1,
          },
        ],
      }),
    );

    const report = aggregator.report();

    expect(report.totalLongFrames).toBe(2);
    expect(report.aggregate[0]).toEqual({ source: "a", count: 2, totalMs: 40, maxMs: 30 });
    expect(report.aggregate[1]).toEqual({ source: "b", count: 1, totalMs: 25, maxMs: 25 });
  });

  test("filters entries by sinceMs but keeps session-wide totals", () => {
    const aggregator = new LongFrameAggregator();
    aggregator.record(summary({ at: 100 }));
    aggregator.record(summary({ at: 200 }));
    aggregator.record(summary({ at: 300 }));

    const report = aggregator.report(200);

    expect(report.entries.map((entry) => entry.at)).toEqual([200, 300]);
    expect(report.totalLongFrames).toBe(3);
  });

  test("the ring and the aggregate map are both bounded", () => {
    const aggregator = new LongFrameAggregator();
    for (let index = 0; index < LONG_FRAME_RING_CAPACITY + 50; index += 1) {
      aggregator.record(
        summary({
          at: index,
          scripts: [
            {
              source: `source-${index}`,
              invokerType: "",
              invoker: "",
              durationMs: 1,
              forcedStyleAndLayoutMs: 0,
              charPosition: -1,
            },
          ],
        }),
      );
    }

    const report = aggregator.report(0, {
      entries: LONG_FRAME_RING_CAPACITY + 100,
      aggregate: LONG_FRAME_AGGREGATE_CAPACITY + 100,
    });

    expect(report.totalLongFrames).toBe(LONG_FRAME_RING_CAPACITY + 50);
    expect(report.entries).toHaveLength(LONG_FRAME_RING_CAPACITY);
    // Distinct sources beyond the cap fold into "(other)" instead of new keys.
    expect(report.aggregate).toHaveLength(LONG_FRAME_AGGREGATE_CAPACITY + 1);
    const overflow = report.aggregate.find((row) => row.source === "(other)");
    expect(overflow?.count).toBe(LONG_FRAME_RING_CAPACITY + 50 - LONG_FRAME_AGGREGATE_CAPACITY);
  });
});
