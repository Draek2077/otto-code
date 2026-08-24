// Live timer accounting for the resource monitor.
//
// The classic React leak is a `setInterval` (or a self-rescheduling `setTimeout`)
// started on mount and never cleared, so every visited chat/tab/editor leaves one
// more behind. Nothing in the platform reports how many are outstanding, so we
// count them by wrapping the globals once, at app start, before anything else has
// scheduled work.
//
// The wrappers delegate immediately and return the host's own handle unchanged,
// so `clearTimeout`/`clearInterval` identity and `this` binding are preserved on
// every platform (browser numbers, Electron numbers, Node objects in tests).
//
// Only timers are patched. `EventTarget.prototype.addEventListener` is
// deliberately left alone: it is a far hotter path, and double-adds of an
// identical listener are no-ops in the DOM but would still be counted, so the
// number would be wrong in exactly the case you'd want to trust it.

import { getGlobalSingleton } from "./global-singleton";

export interface RuntimeCounters {
  /** Intervals started and not yet cleared. Should be flat in a steady-state app. */
  liveIntervals: number;
  /** Timeouts scheduled and neither fired nor cleared. */
  pendingTimeouts: number;
  intervalsCreated: number;
  timeoutsCreated: number;
  /** False when the globals could not be patched - counts are all zero. */
  installed: number;
}

interface TimerHost {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
}

type TimerHandle = ReturnType<typeof setTimeout>;
type NativeScheduler = (handler: unknown, timeout?: number, ...args: unknown[]) => TimerHandle;
type NativeCanceller = (handle?: TimerHandle) => void;

/**
 * A timer callback that ran long enough to be a long frame on its own. Named by
 * its source text and where it was registered, not by a bundle char offset:
 * offsets only resolve against the exact bundle the app loaded, and a working
 * tree that keeps changing under a running dev app makes that mapping drift.
 */
export interface SlowTimerCallback {
  at: number;
  kind: "timeout" | "interval";
  delayMs: number;
  durationMs: number;
  name: string;
  /** First 240 chars of the handler's source, enough to recognize it. */
  source: string;
  /** Top frames of the stack at registration - who scheduled it. */
  registeredAt: string;
}

/**
 * Every timer callback the wrapper ran, by start time on the `performance.now()`
 * clock. A Long Animation Frame reports each script's `startTime` on that same
 * clock, so a frame blamed on "TimerHandler:setTimeout" can be matched back to
 * the handler that fired - even when the handler itself returned quickly and
 * the cost sat in the microtasks it resolved, which LoAF folds into the script
 * and `runTimed` cannot see.
 */
interface TimerFire {
  startedAt: number;
  kind: SlowTimerCallback["kind"];
  delayMs: number;
  handler: (...values: unknown[]) => void;
  registeredAt: string;
}

/** What `describeTimerFireAt` resolves a LoAF timer script to. */
export interface TimerFireDescription {
  kind: SlowTimerCallback["kind"];
  delayMs: number;
  name: string;
  source: string;
  registeredAt: string;
}

interface RuntimeCounterState {
  installed: boolean;
  liveIntervals: number;
  pendingTimeouts: number;
  intervalsCreated: number;
  timeoutsCreated: number;
  slowTimers: SlowTimerCallback[];
  fires: TimerFire[];
}

/** A callback at or past this is a long frame by itself (LONG_FRAME_MS). */
export const SLOW_TIMER_CALLBACK_MS = 50;
export const SLOW_TIMER_RING_CAPACITY = 200;
/** Recent timer fires kept for LoAF matching; the observer reads within a second or two. */
export const TIMER_FIRE_RING_CAPACITY = 400;
/** How far a LoAF script start may sit from the wrapper's own clock read. */
const TIMER_FIRE_MATCH_TOLERANCE_MS = 5;
const SOURCE_SNIPPET_CHARS = 240;
const REGISTRATION_STACK_FRAMES = 6;

// Survives Metro Fast Refresh: module-level state here would reset `installed`
// while the globals stay patched, so the next install wraps the wrappers - one
// more layer on every timer call per refresh - and the counts fork between the
// old closure and the new module. See global-singleton.ts.
const state = getGlobalSingleton<RuntimeCounterState>("otto.diagnostics.runtimeCounters", () => ({
  installed: false,
  liveIntervals: 0,
  pendingTimeouts: 0,
  intervalsCreated: 0,
  timeoutsCreated: 0,
  slowTimers: [],
  fires: [],
}));
// A state object that predates these fields (reattached across a refresh).
state.slowTimers ??= [];
state.fires ??= [];

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function captureRegistrationStack(): string {
  try {
    const stack = new Error().stack ?? "";
    // Drop "Error", this helper, and the patched timer wrapper itself.
    return stack
      .split(String.fromCharCode(10))
      .slice(3, 3 + REGISTRATION_STACK_FRAMES)
      .join(String.fromCharCode(10));
  } catch {
    return "";
  }
}

function recordTimerFire(fire: TimerFire): void {
  state.fires.push(fire);
  if (state.fires.length > TIMER_FIRE_RING_CAPACITY) {
    state.fires.splice(0, state.fires.length - TIMER_FIRE_RING_CAPACITY);
  }
}

function handlerSource(handler: (...values: unknown[]) => void): string {
  try {
    return Function.prototype.toString.call(handler).slice(0, SOURCE_SNIPPET_CHARS);
  } catch {
    return "(unavailable)";
  }
}

function recordSlowTimer(record: SlowTimerCallback): void {
  state.slowTimers.push(record);
  if (state.slowTimers.length > SLOW_TIMER_RING_CAPACITY) {
    state.slowTimers.splice(0, state.slowTimers.length - SLOW_TIMER_RING_CAPACITY);
  }
}

/**
 * Run a timer handler, timing it; anything at or past the long-frame budget is
 * recorded with enough identity to find it in source.
 */
function runTimed(
  handler: (...values: unknown[]) => void,
  callbackArgs: unknown[],
  kind: SlowTimerCallback["kind"],
  delayMs: number,
  registeredAt: string,
): void {
  const startedAt = nowMs();
  recordTimerFire({ startedAt, kind, delayMs, handler, registeredAt });
  try {
    handler(...callbackArgs);
  } finally {
    const durationMs = nowMs() - startedAt;
    if (durationMs >= SLOW_TIMER_CALLBACK_MS) {
      recordSlowTimer({
        at: Date.now(),
        kind,
        delayMs,
        durationMs: Math.round(durationMs * 10) / 10,
        name: handler.name || "(anonymous)",
        source: handlerSource(handler),
        registeredAt,
      });
    }
  }
}

/**
 * Wrap the timer globals so live counts can be read later. Idempotent; safe to
 * call from module scope. Returns true when the counters are live.
 */
export function installRuntimeCounters(
  host: TimerHost = globalThis as unknown as TimerHost,
): boolean {
  if (state.installed) {
    return true;
  }
  if (
    typeof host?.setTimeout !== "function" ||
    typeof host?.clearTimeout !== "function" ||
    typeof host?.setInterval !== "function" ||
    typeof host?.clearInterval !== "function"
  ) {
    return false;
  }

  // The host's own signatures differ between the DOM and React Native typings
  // (string handlers, optional delays), and the wrappers only ever forward what
  // they were given. Widening once here keeps the pass-through honest without
  // four near-identical casts at every call site.
  const nativeSetTimeout = host.setTimeout as unknown as NativeScheduler;
  const nativeClearTimeout = host.clearTimeout as unknown as NativeCanceller;
  const nativeSetInterval = host.setInterval as unknown as NativeScheduler;
  const nativeClearInterval = host.clearInterval as unknown as NativeCanceller;

  // A fired timeout is no longer pending, but `clearTimeout` on an already-fired
  // handle is legal and common, so settled handles are tracked to keep the count
  // from going negative on a double-release.
  const pendingHandles = new Set<TimerHandle>();
  const liveIntervalHandles = new Set<TimerHandle>();

  host.setTimeout = function patchedSetTimeout(
    this: unknown,
    handler: unknown,
    timeout?: number,
    ...args: unknown[]
  ): TimerHandle {
    state.timeoutsCreated += 1;
    if (typeof handler !== "function") {
      // String handlers are eval'd by the host; pass through untouched rather
      // than pretending to track something we cannot wrap.
      return nativeSetTimeout.call(this, handler, timeout, ...args);
    }

    state.pendingTimeouts += 1;
    const registeredAt = captureRegistrationStack();
    let handle: TimerHandle;
    const settle = () => {
      if (pendingHandles.delete(handle)) {
        state.pendingTimeouts -= 1;
      }
    };
    handle = nativeSetTimeout.call(
      this,
      (...callbackArgs: unknown[]) => {
        settle();
        runTimed(
          handler as (...values: unknown[]) => void,
          callbackArgs,
          "timeout",
          timeout ?? 0,
          registeredAt,
        );
      },
      timeout,
      ...args,
    );
    pendingHandles.add(handle);
    return handle;
  } as unknown as typeof setTimeout;

  host.clearTimeout = function patchedClearTimeout(this: unknown, handle?: TimerHandle): void {
    if (handle !== undefined && pendingHandles.delete(handle)) {
      state.pendingTimeouts -= 1;
    }
    nativeClearTimeout.call(this, handle);
  } as unknown as typeof clearTimeout;

  host.setInterval = function patchedSetInterval(
    this: unknown,
    handler: unknown,
    timeout?: number,
    ...args: unknown[]
  ): TimerHandle {
    const registeredAt = typeof handler === "function" ? captureRegistrationStack() : "";
    const timedHandler =
      typeof handler === "function"
        ? (...callbackArgs: unknown[]) =>
            runTimed(
              handler as (...values: unknown[]) => void,
              callbackArgs,
              "interval",
              timeout ?? 0,
              registeredAt,
            )
        : handler;
    const handle = nativeSetInterval.call(this, timedHandler, timeout, ...args);
    state.intervalsCreated += 1;
    if (!liveIntervalHandles.has(handle)) {
      liveIntervalHandles.add(handle);
      state.liveIntervals += 1;
    }
    return handle;
  } as unknown as typeof setInterval;

  host.clearInterval = function patchedClearInterval(this: unknown, handle?: TimerHandle): void {
    if (handle !== undefined && liveIntervalHandles.delete(handle)) {
      state.liveIntervals -= 1;
    }
    nativeClearInterval.call(this, handle);
  } as unknown as typeof clearInterval;

  state.installed = true;
  return true;
}

export function readRuntimeCounters(): RuntimeCounters {
  return {
    liveIntervals: state.liveIntervals,
    pendingTimeouts: state.pendingTimeouts,
    intervalsCreated: state.intervalsCreated,
    timeoutsCreated: state.timeoutsCreated,
    installed: state.installed ? 1 : 0,
  };
}

/** Slow timer callbacks at or after `sinceMs` (all retained ones otherwise), copied out. */
export function getSlowTimerCallbacks(sinceMs?: number): SlowTimerCallback[] {
  return state.slowTimers
    .filter((record) => sinceMs === undefined || record.at >= sinceMs)
    .map((record) => ({
      at: record.at,
      kind: record.kind,
      delayMs: record.delayMs,
      durationMs: record.durationMs,
      name: record.name,
      source: record.source,
      registeredAt: record.registeredAt,
    }));
}

/**
 * The timer callback that started nearest `startedAtMs` (performance.now clock),
 * within a few ms, or null. Used to name the handler behind a Long Animation
 * Frame script whose invoker is a timer.
 */
export function describeTimerFireAt(startedAtMs: number): TimerFireDescription | null {
  let best: TimerFire | null = null;
  let bestDistance = TIMER_FIRE_MATCH_TOLERANCE_MS;
  for (const fire of state.fires) {
    const distance = Math.abs(fire.startedAt - startedAtMs);
    if (distance <= bestDistance) {
      best = fire;
      bestDistance = distance;
    }
  }
  if (!best) {
    return null;
  }
  return {
    kind: best.kind,
    delayMs: best.delayMs,
    name: best.handler.name || "(anonymous)",
    source: handlerSource(best.handler),
    registeredAt: best.registeredAt,
  };
}

/** Test-only: forget the patch so a fresh host can be installed. */
export function resetRuntimeCountersForTest(): void {
  state.installed = false;
  state.liveIntervals = 0;
  state.pendingTimeouts = 0;
  state.intervalsCreated = 0;
  state.timeoutsCreated = 0;
  state.slowTimers = [];
  state.fires = [];
}
