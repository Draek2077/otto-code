import { useSyncExternalStore } from "react";

// Cross-row layout registry for assistant bubble widths, a sibling of
// bubble-group-offsets.ts. The per-turn playback button (message-playback-button)
// lives in the turn footer, a stream row of its own below the message, and pins
// to the right edge of the message it reads aloud. The footer can't see the
// bubble's box directly, so every assistant bubble reports its rendered width
// here keyed by the same turn key the footer resolves (blockGroupId ?? id), and
// the footer reads back the widest segment of that group to size its row.
//
// A standalone reply hugs its content (alignSelf flex-start) so its reported
// width is the true bubble width; a split/streamed reply's continuation segments
// stretch to the full chat column, so its group width is the column — which is
// exactly what "pin a long message to the right" wants. Widths survive row
// unmount (virtualized rows remount) and evict oldest-first past a small cap,
// same as the height registry.

const MAX_TRACKED_GROUPS = 64;

// Sub-pixel layout jitters by fractions of a px between passes; a change this
// small can't move the pinned button visibly and isn't worth waking subscribers.
const WIDTH_CHANGE_EPSILON = 0.5;

const groupWidths = new Map<string, Map<number, number>>();
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

export function reportAssistantBubbleWidth(input: {
  groupId: string;
  blockIndex: number;
  width: number;
}): void {
  if (!Number.isFinite(input.width) || input.width <= 0) {
    return;
  }
  let widths = groupWidths.get(input.groupId);
  if (!widths) {
    widths = new Map();
    groupWidths.set(input.groupId, widths);
    while (groupWidths.size > MAX_TRACKED_GROUPS) {
      const oldest = groupWidths.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      groupWidths.delete(oldest);
    }
  }
  const previous = widths.get(input.blockIndex);
  if (previous !== undefined && Math.abs(previous - input.width) < WIDTH_CHANGE_EPSILON) {
    return;
  }
  widths.set(input.blockIndex, input.width);
  notify();
}

/** The widest reported segment of the group, in px; 0 when nothing is known. */
export function getAssistantBubbleWidth(groupId: string): number {
  const widths = groupWidths.get(groupId);
  if (!widths) {
    return 0;
  }
  let max = 0;
  for (const width of widths.values()) {
    if (width > max) {
      max = width;
    }
  }
  return max;
}

/**
 * The rendered width of the assistant bubble group, so its turn footer can pin
 * the playback button to the message's right edge. Returns 0 for an unknown or
 * absent group (the footer then keeps its natural left-hugging layout).
 */
export function useAssistantBubbleWidth(groupId: string | undefined): number {
  return useSyncExternalStore(
    subscribe,
    () => (groupId === undefined ? 0 : getAssistantBubbleWidth(groupId)),
    () => 0,
  );
}

export function clearAssistantBubbleWidths(): void {
  groupWidths.clear();
}
