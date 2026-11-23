interface CanaryWait {
  watchRoot: string;
  timeoutMs: number;
  reported: Promise<void>;
  signal?: AbortSignal;
  touch(): Promise<void>;
}

const PROBE_INTERVAL_MS = 1_000;

function waitForProbe(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    function abort() {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    }
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** A native stream can start after the initial creation. Only a real callback proves readiness. */
export async function waitForWatcherCanary(input: CanaryWait): Promise<void> {
  const observed = new AbortController();
  const signal = input.signal ? AbortSignal.any([input.signal, observed.signal]) : observed.signal;
  const deadline = performance.now() + input.timeoutMs;
  void input.reported.then(() => observed.abort());
  try {
    for (;;) {
      input.signal?.throwIfAborted();
      if (observed.signal.aborted) return;
      const remainingMs = deadline - performance.now();
      if (remainingMs <= 0) {
        throw new Error(
          `Watcher for ${input.watchRoot} did not report its liveness canary within ${input.timeoutMs}ms`,
        );
      }
      try {
        await waitForProbe(Math.min(PROBE_INTERVAL_MS, remainingMs), signal);
      } catch (error) {
        input.signal?.throwIfAborted();
        if (!observed.signal.aborted) throw error;
      }
      input.signal?.throwIfAborted();
      if (observed.signal.aborted) return;
      // Do not extend the original deadline or write again at its expiry.
      if (performance.now() >= deadline) continue;
      // Serialize writes and await the last one before the caller removes its canary.
      await input.touch();
    }
  } finally {
    observed.abort();
  }
}
