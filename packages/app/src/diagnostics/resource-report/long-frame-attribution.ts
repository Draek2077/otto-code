// Long-frame attribution for the resource monitor.
//
// The frame sampler says *that* a frame blew past 50ms; this module says *what
// ran inside it*. It observes the Long Animation Frames API (Chromium 123+,
// which covers Electron and desktop web - the surfaces where stutter is
// reported) and keeps two bounded views:
//
//  - a ring of recent long frames with their per-script breakdown, so a capture
//    can show the exact frames the user just felt, and
//  - a session-wide aggregate keyed by script source, so "what has been janking
//    all session" survives the ring rolling over.
//
// Both are capped - the instrument must not become the leak it hunts. The pure
// shaping (`summarizeLongAnimationFrame`, `LongFrameAggregator`) is separate
// from the observer wiring so it is testable without a browser frame loop.

import { getGlobalSingleton } from "./global-singleton";
import { describeTimerFireAt, type TimerFireDescription } from "./runtime-counters";

/** Chromium's `PerformanceScriptTiming` - not in the TS lib yet. */
interface PerformanceScriptTiming extends PerformanceEntry {
  invoker?: string;
  invokerType?: string;
  sourceURL?: string;
  sourceFunctionName?: string;
  sourceCharPosition?: number;
  forcedStyleAndLayoutDuration?: number;
}

/** Chromium's `PerformanceLongAnimationFrameTiming` - not in the TS lib yet. */
export interface PerformanceLongAnimationFrameTiming extends PerformanceEntry {
  blockingDuration?: number;
  renderStart?: number;
  styleAndLayoutStart?: number;
  scripts?: PerformanceScriptTiming[];
}

export interface LongFrameScriptSummary {
  /** `sourceURL@functionName` when known, else the invoker, else "(unknown)". */
  source: string;
  invokerType: string;
  /**
   * The raw invoker, always kept: for an anonymous callback this is the only
   * field that says what fired it ("Window.setInterval", a rAF, an observer).
   */
  invoker: string;
  durationMs: number;
  forcedStyleAndLayoutMs: number;
  charPosition: number;
  /**
   * For a timer-invoked script, the handler that fired, matched by start time
   * against the wrapped timer globals. Names the callback even when its own
   * run was cheap and the frame's cost sat in the microtasks it resolved.
   */
  timer?: TimerFireDescription;
}

export interface LongFrameSummary {
  /** Epoch ms - LoAF startTime is timeOrigin-relative, converted at record time. */
  at: number;
  durationMs: number;
  /** Time beyond the 50ms budget plus long-task time - the "felt" cost. */
  blockingMs: number;
  /** Style+layout share of the frame, 0 when the frame never reached render. */
  styleAndLayoutMs: number;
  scripts: LongFrameScriptSummary[];
}

export interface LongFrameAggregateRow {
  source: string;
  count: number;
  totalMs: number;
  maxMs: number;
}

export interface LongFrameReport {
  supported: boolean;
  /** Epoch ms the observer started, so counts have a denominator. */
  observedSince: number | null;
  /** Long frames recorded in total, including ones the ring has dropped. */
  totalLongFrames: number;
  /** Recent long frames at or after `sinceMs` (all retained ones otherwise). */
  entries: LongFrameSummary[];
  /** Session-wide script cost, ranked by total main-thread ms. */
  aggregate: LongFrameAggregateRow[];
}

/** Recent-frame ring capacity. At one long frame per second this is ~8 minutes. */
export const LONG_FRAME_RING_CAPACITY = 500;
/** Scripts kept per frame - past the top few the tail is noise. */
export const LONG_FRAME_SCRIPTS_PER_ENTRY = 5;
/** Aggregate key cap. Overflow folds into "(other)" instead of growing the map. */
export const LONG_FRAME_AGGREGATE_CAPACITY = 200;
const AGGREGATE_OVERFLOW_KEY = "(other)";

/** Chromium names timer invokers "TimerHandler:setTimeout" / "TimerHandler:setInterval". */
function isTimerInvoker(script: PerformanceScriptTiming): boolean {
  return (
    script.invokerType === "user-callback" && (script.invoker ?? "").startsWith("TimerHandler:")
  );
}

function timerLabel(timer: TimerFireDescription): string {
  if (timer.name !== "(anonymous)") {
    return timer.name;
  }
  // An anonymous handler is named by whoever scheduled it - the first
  // registration frame reads like "at flushPendingTranscript (...)".
  const registrar = /at\s+([^\s(]+)/.exec(timer.registeredAt)?.[1];
  return registrar ? `(anonymous from ${registrar})` : "(anonymous)";
}

function scriptSource(script: PerformanceScriptTiming, timer?: TimerFireDescription): string {
  const url = script.sourceURL ?? "";
  const fn = script.sourceFunctionName ?? "";
  if (timer) {
    // A timer script arrives with no function name (the wrapper is anonymous),
    // so the matched handler is the identity the aggregate should key on.
    return `${url}@timer:${timerLabel(timer)}`;
  }
  if (url || fn) {
    return fn ? `${url}@${fn}` : url;
  }
  return script.invoker || "(unknown)";
}

export type TimerFireResolver = (startedAtMs: number) => TimerFireDescription | null;

export function summarizeLongAnimationFrame(
  entry: PerformanceLongAnimationFrameTiming,
  timeOrigin: number,
  resolveTimerFire: TimerFireResolver = describeTimerFireAt,
): LongFrameSummary {
  const styleAndLayoutStart = entry.styleAndLayoutStart ?? 0;
  const frameEnd = entry.startTime + entry.duration;
  const scripts = [...(entry.scripts ?? [])]
    .sort((left, right) => right.duration - left.duration)
    .slice(0, LONG_FRAME_SCRIPTS_PER_ENTRY)
    .map((script): LongFrameScriptSummary => {
      const timer = isTimerInvoker(script)
        ? (resolveTimerFire(script.startTime) ?? undefined)
        : undefined;
      const summary: LongFrameScriptSummary = {
        source: scriptSource(script, timer),
        invokerType: script.invokerType ?? "",
        invoker: script.invoker ?? "",
        durationMs: round(script.duration),
        forcedStyleAndLayoutMs: round(script.forcedStyleAndLayoutDuration ?? 0),
        charPosition: script.sourceCharPosition ?? -1,
      };
      if (timer) {
        summary.timer = timer;
      }
      return summary;
    });
  return {
    at: Math.round(timeOrigin + entry.startTime),
    durationMs: round(entry.duration),
    blockingMs: round(entry.blockingDuration ?? 0),
    styleAndLayoutMs: styleAndLayoutStart > 0 ? round(frameEnd - styleAndLayoutStart) : 0,
    scripts,
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export class LongFrameAggregator {
  private readonly ring: LongFrameSummary[] = [];
  private readonly bySource = new Map<string, LongFrameAggregateRow>();
  private total = 0;

  record(summary: LongFrameSummary): void {
    this.total += 1;
    this.ring.push(summary);
    if (this.ring.length > LONG_FRAME_RING_CAPACITY) {
      this.ring.splice(0, this.ring.length - LONG_FRAME_RING_CAPACITY);
    }
    for (const script of summary.scripts) {
      const key =
        this.bySource.has(script.source) || this.bySource.size < LONG_FRAME_AGGREGATE_CAPACITY
          ? script.source
          : AGGREGATE_OVERFLOW_KEY;
      const row = this.bySource.get(key);
      if (row) {
        row.count += 1;
        row.totalMs = round(row.totalMs + script.durationMs);
        row.maxMs = Math.max(row.maxMs, script.durationMs);
      } else {
        this.bySource.set(key, {
          source: key,
          count: 1,
          totalMs: script.durationMs,
          maxMs: script.durationMs,
        });
      }
    }
  }

  report(
    sinceMs?: number,
    limits?: { entries?: number; aggregate?: number },
  ): {
    totalLongFrames: number;
    entries: LongFrameSummary[];
    aggregate: LongFrameAggregateRow[];
  } {
    const entryLimit = limits?.entries ?? 200;
    const aggregateLimit = limits?.aggregate ?? 30;
    const entries = (
      sinceMs === undefined ? [...this.ring] : this.ring.filter((entry) => entry.at >= sinceMs)
    ).slice(-entryLimit);
    const aggregate = [...this.bySource.values()]
      .sort((left, right) => right.totalMs - left.totalMs)
      .slice(0, aggregateLimit)
      // Copied out so a caller cannot mutate the running totals.
      .map((row) => ({
        source: row.source,
        count: row.count,
        totalMs: row.totalMs,
        maxMs: row.maxMs,
      }));
    return { totalLongFrames: this.total, entries, aggregate };
  }
}

// ---------------------------------------------------------------------------
// Observer wiring (impure). Feature-detected: absent API degrades to
// `supported: false` in the report rather than breaking the monitor.
// ---------------------------------------------------------------------------

interface LongFrameRuntime {
  observer: PerformanceObserver | null;
  aggregator: LongFrameAggregator | null;
  observedSince: number | null;
}

// Survives Metro Fast Refresh: module-level state here would reset while the
// old observer keeps firing, and a second observer would double-count every
// long frame. See global-singleton.ts.
const runtime = getGlobalSingleton<LongFrameRuntime>(
  "otto.diagnostics.longFrameAttribution",
  () => ({
    observer: null,
    aggregator: null,
    observedSince: null,
  }),
);

export function isLongFrameAttributionSupported(): boolean {
  return (
    typeof PerformanceObserver !== "undefined" &&
    Array.isArray(PerformanceObserver.supportedEntryTypes) &&
    PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")
  );
}

export function startLongFrameAttribution(): void {
  if (runtime.observer || !isLongFrameAttributionSupported()) {
    return;
  }
  try {
    const aggregator = new LongFrameAggregator();
    runtime.aggregator = aggregator;
    runtime.observedSince = Date.now();
    const timeOrigin = performance.timeOrigin;
    runtime.observer = new PerformanceObserver((list) => {
      // The observer callback itself runs on the main thread inside a frame;
      // shaping is O(scripts per entry) and bounded, so it cannot become the
      // long task it is measuring.
      for (const entry of list.getEntries()) {
        aggregator.record(
          summarizeLongAnimationFrame(entry as PerformanceLongAnimationFrameTiming, timeOrigin),
        );
      }
    });
    runtime.observer.observe({ type: "long-animation-frame", buffered: true });
  } catch {
    runtime.observer = null;
    runtime.aggregator = null;
    runtime.observedSince = null;
  }
}

export function stopLongFrameAttribution(): void {
  runtime.observer?.disconnect();
  runtime.observer = null;
  runtime.aggregator = null;
  runtime.observedSince = null;
}

export function getLongFrameReport(sinceMs?: number): LongFrameReport {
  if (!runtime.aggregator) {
    return {
      supported: isLongFrameAttributionSupported(),
      observedSince: null,
      totalLongFrames: 0,
      entries: [],
      aggregate: [],
    };
  }
  const { totalLongFrames, entries, aggregate } = runtime.aggregator.report(sinceMs);
  return {
    supported: true,
    observedSince: runtime.observedSince,
    totalLongFrames,
    entries,
    aggregate,
  };
}
