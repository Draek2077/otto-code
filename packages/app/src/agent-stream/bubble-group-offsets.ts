import { useSyncExternalStore } from "react";

// Cross-row layout registry for assistant bubble groups. A streamed reply is
// split into several assistant_message rows sharing a blockGroupId that butt
// together and paint as one continuous bubble (see spacing.ts). The
// BubbleCornerSheen gradient must span that whole visual bubble, but each row
// can only paint inside its own bounds — so every grouped segment reports its
// bubble height here, and continuation segments read the summed height of the
// segments above them to shift the shared gradient into group space.
//
// Heights are keyed by (groupId, blockIndex) and deliberately survive row
// unmount: virtualized rows scroll out and remount, and a continuation's
// offset must not collapse while the rows above it are off-screen. Groups are
// evicted oldest-first past a small cap instead.

const MAX_TRACKED_GROUPS = 64;

// Sub-pixel text layout jitters by fractions of a px between passes; changes
// below this threshold are invisible on a soft gradient and not worth waking
// every subscribed segment for.
const HEIGHT_CHANGE_EPSILON = 0.5;

const groupHeights = new Map<string, Map<number, number>>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function reportBubbleSegmentHeight(input: {
  groupId: string;
  blockIndex: number;
  height: number;
}): void {
  if (!Number.isFinite(input.height) || input.height <= 0) {
    return;
  }
  let heights = groupHeights.get(input.groupId);
  if (!heights) {
    heights = new Map();
    groupHeights.set(input.groupId, heights);
    while (groupHeights.size > MAX_TRACKED_GROUPS) {
      const oldest = groupHeights.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      groupHeights.delete(oldest);
    }
  }
  const previous = heights.get(input.blockIndex);
  if (previous !== undefined && Math.abs(previous - input.height) < HEIGHT_CHANGE_EPSILON) {
    return;
  }
  heights.set(input.blockIndex, input.height);
  notify();
}

/** Summed reported heights of the group's segments above blockIndex, in px. */
export function getBubbleGroupOffset(groupId: string, blockIndex: number): number {
  const heights = groupHeights.get(groupId);
  if (!heights) {
    return 0;
  }
  let offset = 0;
  for (const [index, height] of heights) {
    if (index < blockIndex) {
      offset += height;
    }
  }
  return offset;
}

/**
 * A segment's distance from its visual bubble group's top edge. Returns 0 for
 * ungrouped messages and for the group's own top segment; continuation
 * segments re-render as the rows above them report their heights.
 */
export function useBubbleGroupOffset(
  groupId: string | undefined,
  blockIndex: number | undefined,
): number {
  return useSyncExternalStore(
    subscribe,
    () =>
      groupId === undefined || blockIndex === undefined || blockIndex <= 0
        ? 0
        : getBubbleGroupOffset(groupId, blockIndex),
    () => 0,
  );
}

export function clearBubbleGroupOffsets(): void {
  groupHeights.clear();
}
