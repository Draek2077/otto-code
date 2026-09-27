// How a client paces its requests for hosted browser frames. Shared so the app
// and the stream measurement script run the same loop.

/** How long the host may hold a frame request open waiting for a repaint. */
export const FRAME_LONG_POLL_MS = 10_000;

// A held request that returns at once with nothing was not held. Without a
// floor, a host that ignores the wait would be asked again in a tight loop.
const UNHELD_RESPONSE_MS = 50;
const UNHELD_FLOOR_MS = 250;

export interface FramePollInput {
  /** The last response carried a frame. */
  receivedFrame: boolean;
  /** How long the last request took to answer. */
  elapsedMs: number;
}

/** The pause before the next held frame request. */
export function nextFramePollDelayMs(input: FramePollInput): number {
  return input.receivedFrame || input.elapsedMs >= UNHELD_RESPONSE_MS ? 0 : UNHELD_FLOOR_MS;
}
