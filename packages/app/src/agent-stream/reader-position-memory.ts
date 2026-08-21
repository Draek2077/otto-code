// Where a detached reader was in a chat, remembered across a remount of that
// chat's transcript.
//
// A chat tab is retained at `display: none` while it is not the frontmost tab in
// its pane, but only up to `mountedTabLimit` tabs per pane (see
// mounted-tab-retention.ts). Past that the tab is UNMOUNTED, and coming back to
// it mounts a fresh `WebStreamViewport`, whose activation path takes the bottom.
// That is right for opening a chat and wrong for returning to one: the reader
// had taken the position, and `docs/chat-scrolling.md` says the app does not
// write it while they hold it. Nothing in the component survived the unmount to
// say so, so the position was lost on every eviction.
//
// The memory is a row id plus the offset that row had from the top of the
// viewport, not a `scrollTop`. A remount re-renders the transcript from
// estimates and re-measures it over the following frames, so a pixel offset
// means something different on the way back in; an anchor row does not.
//
// This is app-session state on purpose. It is not persisted, and it is dropped
// as soon as the reader returns to the bottom, because at that point they have
// asked to follow output again.

/** A reader's place in a transcript, anchored to a row rather than to pixels. */
export interface ReaderPosition {
  /** `data-history-row-id` of the row at the reading line. */
  rowId: string;
  /** That row's top, relative to the top of the scroll viewport. */
  viewportOffset: number;
}

/**
 * How many chats keep a remembered position. Sized as "more chats than a
 * session cycles between", far below the number a long session accumulates, so
 * this can never grow into a leak. Eviction is oldest-write-first.
 */
export const MAX_REMEMBERED_READER_POSITIONS = 32;

const readerPositions = new Map<string, ReaderPosition>();

/**
 * Drop the oldest entries until `positions` is within `limit`. Exported for the
 * test; callers use `rememberReaderPosition`.
 */
export function pruneReaderPositions(
  positions: Map<string, ReaderPosition>,
  limit = MAX_REMEMBERED_READER_POSITIONS,
): void {
  const cap = Math.max(1, limit);
  while (positions.size > cap) {
    const oldest = positions.keys().next();
    if (oldest.done) {
      return;
    }
    positions.delete(oldest.value);
  }
}

export function rememberReaderPosition(agentId: string, position: ReaderPosition): void {
  if (!agentId) {
    return;
  }
  // Re-insert so a chat the reader is actively holding sorts as the newest.
  readerPositions.delete(agentId);
  readerPositions.set(agentId, position);
  pruneReaderPositions(readerPositions);
}

export function readReaderPosition(agentId: string): ReaderPosition | null {
  if (!agentId) {
    return null;
  }
  return readerPositions.get(agentId) ?? null;
}

/** Called when the reader reaches the bottom again: they asked to follow output. */
export function forgetReaderPosition(agentId: string): void {
  readerPositions.delete(agentId);
}

/** Test seam. Not used by the app. */
export function clearReaderPositions(): void {
  readerPositions.clear();
}
