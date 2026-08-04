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

let installed = false;
let liveIntervals = 0;
let pendingTimeouts = 0;
let intervalsCreated = 0;
let timeoutsCreated = 0;

/**
 * Wrap the timer globals so live counts can be read later. Idempotent; safe to
 * call from module scope. Returns true when the counters are live.
 */
export function installRuntimeCounters(
  host: TimerHost = globalThis as unknown as TimerHost,
): boolean {
  if (installed) {
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
    timeoutsCreated += 1;
    if (typeof handler !== "function") {
      // String handlers are eval'd by the host; pass through untouched rather
      // than pretending to track something we cannot wrap.
      return nativeSetTimeout.call(this, handler, timeout, ...args);
    }

    pendingTimeouts += 1;
    let handle: TimerHandle;
    const settle = () => {
      if (pendingHandles.delete(handle)) {
        pendingTimeouts -= 1;
      }
    };
    handle = nativeSetTimeout.call(
      this,
      (...callbackArgs: unknown[]) => {
        settle();
        (handler as (...values: unknown[]) => void)(...callbackArgs);
      },
      timeout,
      ...args,
    );
    pendingHandles.add(handle);
    return handle;
  } as unknown as typeof setTimeout;

  host.clearTimeout = function patchedClearTimeout(this: unknown, handle?: TimerHandle): void {
    if (handle !== undefined && pendingHandles.delete(handle)) {
      pendingTimeouts -= 1;
    }
    nativeClearTimeout.call(this, handle);
  } as unknown as typeof clearTimeout;

  host.setInterval = function patchedSetInterval(
    this: unknown,
    handler: unknown,
    timeout?: number,
    ...args: unknown[]
  ): TimerHandle {
    const handle = nativeSetInterval.call(this, handler, timeout, ...args);
    intervalsCreated += 1;
    if (!liveIntervalHandles.has(handle)) {
      liveIntervalHandles.add(handle);
      liveIntervals += 1;
    }
    return handle;
  } as unknown as typeof setInterval;

  host.clearInterval = function patchedClearInterval(this: unknown, handle?: TimerHandle): void {
    if (handle !== undefined && liveIntervalHandles.delete(handle)) {
      liveIntervals -= 1;
    }
    nativeClearInterval.call(this, handle);
  } as unknown as typeof clearInterval;

  installed = true;
  return true;
}

export function readRuntimeCounters(): RuntimeCounters {
  return {
    liveIntervals,
    pendingTimeouts,
    intervalsCreated,
    timeoutsCreated,
    installed: installed ? 1 : 0,
  };
}

/** Test-only: forget the patch so a fresh host can be installed. */
export function resetRuntimeCountersForTest(): void {
  installed = false;
  liveIntervals = 0;
  pendingTimeouts = 0;
  intervalsCreated = 0;
  timeoutsCreated = 0;
}
