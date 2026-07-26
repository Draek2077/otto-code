// Which assistant bubble segments this client WATCHED being written — a sibling
// registry to assistant-bubble-text.ts and message-playback-activity.ts, and it
// exists for a sharper version of the same structural reason.
//
// Auto-speech may only read what it saw arrive: opening a chat must never start
// reciting its history. The natural place for that latch is the message row,
// which knows whether it carries a live reveal span — and that is where it
// started life, as a ref. But row identity does not survive the end of the turn.
// The segment the model is still appending to lives in the stream head as
// `<group>:head`, and when the head flushes into the canonical tail it is
// rewritten to `<group>:block:<n>` (see finalizeHeadItems in types/stream.ts).
// The id is the list key, so React unmounts that row and mounts a fresh one —
// with a fresh ref, no memory of having been live, and no live span left to
// re-derive it from, because the reveal spans vanish the instant the turn stops
// running. The row that loses its memory is always the reply's LAST paragraph,
// which is exactly the paragraph auto-speech went silent on: multi-paragraph
// replies were read up to their final block and then stopped.
//
// (groupId, blockIndex) is stable across that flush — only the id changes — so
// the latch lives here, keyed by the pair, and outlives the remount.

// The witness set outlives every row it came from, so it is capped oldest-first,
// the same shape as the bubble-text registry's group cap.
const MAX_TRACKED_SEGMENTS = 512;

const witnessed = new Set<string>();

function witnessKey(input: { groupId: string; blockIndex: number }): string {
  return `${input.groupId}:${input.blockIndex}`;
}

/** Record that this segment rendered while its turn was still being written. */
export function markLiveTurnSegmentWitnessed(input: { groupId: string; blockIndex: number }): void {
  const key = witnessKey(input);
  if (witnessed.has(key)) {
    return;
  }
  witnessed.add(key);
  while (witnessed.size > MAX_TRACKED_SEGMENTS) {
    const oldest = witnessed.values().next().value;
    if (oldest === undefined) {
      break;
    }
    witnessed.delete(oldest);
  }
}

/** Whether this segment was ever seen live — false for anything read back from
 * history, which is the whole point of asking. */
export function wasLiveTurnSegmentWitnessed(input: {
  groupId: string;
  blockIndex: number;
}): boolean {
  return witnessed.has(witnessKey(input));
}

/** Test seam — the registry is global by design. */
export function clearLiveTurnWitnesses(): void {
  witnessed.clear();
}
