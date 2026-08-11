// Reader ownership uses the same small band as the visible bottom indicator.
// A drag that leaves it must detach, including immediately after the keyboard
// changes the viewport. Do not widen this to absorb Android layout drift: that
// turns ordinary reader input into a snap back to the newest message.
export const NATIVE_BOTTOM_OWNERSHIP_THRESHOLD_PX = 8;

// Android can report a small offset while it finishes preserving an inverted
// list during non-user layout changes. This wider band is only for correcting
// that passive drift while follow mode owns the transcript.
const NATIVE_BOTTOM_RESTICK_THRESHOLD_PX = 64;

export function isNativeReaderAtNewestEdge(offsetY: number): boolean {
  return offsetY <= NATIVE_BOTTOM_OWNERSHIP_THRESHOLD_PX;
}

export function isNativePassiveRestickEligible(offsetY: number): boolean {
  return offsetY <= NATIVE_BOTTOM_RESTICK_THRESHOLD_PX;
}
