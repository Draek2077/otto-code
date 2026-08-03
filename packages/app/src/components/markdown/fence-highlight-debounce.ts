import { useEffect, useRef, useState } from "react";

/**
 * How long a still-growing fence coalesces before it is re-highlighted.
 *
 * A fence that has not closed yet cannot be promoted out of the live tail block
 * (`utils/split-markdown-blocks.ts`), so every ~32 ms reveal tick hands the
 * highlighter a longer string than the tick before it. Tokenization is cached on
 * the whole code (`utils/highlight-cache.ts`), so each tick misses, runs a full
 * synchronous Lezer pass over the entire fence-so-far, re-runs `detectLanguage`
 * for untagged fences, and evicts the prefix it just replaced. Work per streamed
 * fence is quadratic in its finished length, on the UI thread, during the one
 * workload the product exists for.
 *
 * Quantizing the code the highlighter sees to one commit per window turns that
 * back into roughly linear work: ~4 passes a second instead of ~30. Same number
 * as `MERMAID_RENDER_DEBOUNCE_MS`, chosen for the same reason — long enough to
 * swallow a burst of flushes, short enough that nobody waits on it.
 */
export const FENCE_HIGHLIGHT_DEBOUNCE_MS = 250;

/**
 * The code a fence should hand to the highlighter right now.
 *
 * A throttle with a guaranteed trailing commit, **not** a plain debounce. A
 * plain debounce restarts its timer on every delta, so a fence streaming for
 * thirty seconds would show nothing at all until the model stopped typing. Here
 * the first delta after a quiet window schedules one commit and every later
 * delta rides along with it: the block keeps growing while it streams, in
 * ~250 ms steps instead of ~32 ms ones, and the last delta always lands within
 * one window of the stream ending.
 *
 * Settled content never waits. The first value is returned on mount, so a
 * closed fence — history, the file viewer, the pull-request panel — is fully
 * highlighted on its first paint. Anything that is not an append (a rewind, a
 * different message, a file the viewer just opened) replaces the current value
 * immediately; holding a stale body there would be a wrong answer rather than a
 * slightly late one.
 *
 * This is purely about what the fence renders. It writes no scroll position and
 * touches nothing in the follow/detach machinery (docs/chat-scrolling.md).
 */
export function useSettledFenceCode(code: string): string {
  const [settled, setSettled] = useState(code);
  const latestRef = useRef(code);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Declared before the scheduling effect so React runs its cleanup first.
  // Clearing the handle without dropping the ref would strand every later
  // commit behind a timer that can no longer fire.
  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    latestRef.current = code;
    if (code === settled) return;

    if (!code.startsWith(settled)) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setSettled(code);
      return;
    }

    // A commit is already scheduled and will pick up whatever has arrived by
    // the time it fires. Resetting the timer here is exactly what would freeze
    // the block for the length of the stream.
    if (timerRef.current) return;

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setSettled(latestRef.current);
    }, FENCE_HIGHLIGHT_DEBOUNCE_MS);
  }, [code, settled]);

  return settled;
}
