import type { StreamItem } from "@/types/stream";
import { estimateAssistantMessageHeightFromCache } from "@/utils/assistant-message-height-estimate";

// Below this many items the whole stream stays mounted: virtualizing a short chat costs
// more in measurement churn than it saves.
export const DEFAULT_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD = 100;
// The tail that is never virtualized, so the live turn and the messages around it keep
// their exact heights and the bottom anchor cannot drift.
//
// These are upstream Paseo's numbers, restored deliberately. They were cut to 12/8
// (and the threshold to 40) for mobile streaming cost, which parked the virtualizer
// right against the live turn and forced a compensation layer (a walk-back cap, an
// extra absorb path) whose interactions produced the "thrown to the top of the chat"
// family of bugs. A cheaper transcript is won by making rows cheaper, not by running
// the virtualizer close to the reader's eyes.
export const DEFAULT_WEB_MOUNTED_RECENT_STREAM_ITEMS = 50;
const COLLAPSED_TOOL_SEQUENCE_ROW_HEIGHT_ESTIMATE = 40;

type BottomAnchorE2ETestGlobals = typeof globalThis & {
  __OTTO_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD?: unknown;
  __OTTO_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS?: unknown;
};

function readPositiveIntegerOverride(value: unknown): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.trunc(value as number);
  return normalized > 0 ? normalized : null;
}

export function getWebPartialVirtualizationThreshold(): number {
  const override = readPositiveIntegerOverride(
    (globalThis as BottomAnchorE2ETestGlobals).__OTTO_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD,
  );
  return override ?? DEFAULT_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD;
}

export function getWebMountedRecentStreamItems(): number {
  const override = readPositiveIntegerOverride(
    (globalThis as BottomAnchorE2ETestGlobals).__OTTO_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS,
  );
  return override ?? DEFAULT_WEB_MOUNTED_RECENT_STREAM_ITEMS;
}

/**
 * Whether a virtualized row swapping its estimate for its measured height may
 * move `scrollTop`.
 *
 * One condition: **is the row above the viewport**. Growth above the reader is
 * absorbed in both states, because in both states it is growth they must not be
 * moved by.
 *
 * It used to be two, with a `isFollowingOutput` early return on the reasoning
 * that "the app is heading to the bottom anyway and an adjustment would only
 * fight the stick". It does not fight the stick, and skipping it is what threw
 * the reader to the top of the transcript on send.
 *
 * The stick writes an *absolute* position (`scrollTop = scrollHeight`), so a
 * relative correction applied before it is overwritten, never doubled. What the
 * early return actually bought was a gap. Sending releases the mounted-window pin
 * (see findMountedWindowStart), which hands a turn measured at its real heights
 * back to the virtualizer at estimated ones; the browser clamps `scrollTop` to
 * the collapsed range, and then the virtualizer re-measures those rows one batch
 * at a time and grows the document back by thousands of pixels, all of it *above*
 * the viewport. Uncompensated, every batch pushed the view further from the end,
 * and the rAF stick was left chasing a document growing faster than one frame per
 * batch. Deep history is the bad case, because none of it has cached block
 * heights: a reply estimated at 220px measuring 800 is a 580px shove per row.
 *
 * The condition that remains is TanStack Virtual's own default
 * (`item.start < scrollOffset`), and overriding
 * `shouldAdjustScrollPositionOnItemSizeChange` replaces it wholesale - so an
 * override that returns a single global answer silently opts every row in,
 * including the ones being measured *below* the fold. Growth the reader cannot
 * see must not move them: scrolling up feeds the virtualizer a steady supply of
 * never-measured rows (overscan 8) whose estimates undershoot, and compensating
 * for those cancels out part of every upward gesture. The transcript then stalls
 * short of its first message and jitters, by whatever that chat's accumulated
 * estimate error happens to be. See docs/chat-scrolling.md.
 *
 * Positions are viewport-relative because that is what survives the whole
 * container moving on screen; `rowStart` is the row's offset from the top of the
 * virtualized block, which is the frame the virtualizer reports it in.
 */
export function shouldAbsorbVirtualRowResize(input: {
  blockViewportRelativeTop: number;
  rowStart: number;
}): boolean {
  return input.blockViewportRelativeTop + input.rowStart < 0;
}

export interface IndexedStreamItem {
  item: StreamItem;
  index: number;
}

export interface WebVirtualizedHistoryWindow {
  virtualizedEntries: IndexedStreamItem[];
  mountedEntries: IndexedStreamItem[];
}

export function estimateStreamItemHeight(item: StreamItem): number {
  switch (item.kind) {
    case "user_message":
      return item.images && item.images.length > 0 ? 220 : 96;
    case "assistant_message":
      return estimateAssistantMessageHeightFromCache(item.text) ?? 220;
    case "tool_call":
      return COLLAPSED_TOOL_SEQUENCE_ROW_HEIGHT_ESTIMATE;
    case "thought":
      return COLLAPSED_TOOL_SEQUENCE_ROW_HEIGHT_ESTIMATE;
    case "action_group":
      return COLLAPSED_TOOL_SEQUENCE_ROW_HEIGHT_ESTIMATE;
    case "todo_list":
      return 144;
    case "activity_log":
      return 88;
    case "compaction":
      return 72;
    default:
      return 120;
  }
}

/**
 * Where the mounted (real-DOM) window begins. Everything before it is handed to
 * the virtualizer, which renders it from estimates (or the measured-height
 * cache in `strategy-web.tsx`, when the row was ever mounted) until re-measured.
 *
 * The walk-back always rewinds to the turn's opening user message, deliberately
 * uncapped. A capped walk used to settle for a boundary *inside* a long
 * streaming turn, which advanced the boundary mid-turn: every advance handed
 * measured rows to the virtualizer in a single frame, and the resulting
 * document shrink + scrollTop clamp is what spontaneously detached a reader who
 * was just watching the stream. With the full walk, the boundary is frozen for
 * the whole of a turn and only moves when a new user message enters - which is
 * a send, an explicit bottom request. The cost is Paseo's cost: a very long
 * turn stays fully mounted while it streams.
 *
 * `pinnedStartItemId` is the detached-reader guard: while the reader is
 * scrolled away from the bottom, the caller pins the current boundary and the
 * window only ever holds OPEN (a smaller start mounts more). Nothing already on
 * screen is yanked into the virtualizer under them. The pin releases when they
 * return to the bottom.
 */
export function findMountedWindowStart(input: {
  items: StreamItem[];
  minMountedCount: number;
  pinnedStartItemId?: string | null;
}): number {
  const { items, minMountedCount, pinnedStartItemId } = input;
  if (items.length <= minMountedCount) {
    return 0;
  }

  let startIndex = Math.max(items.length - minMountedCount, 0);
  while (startIndex > 0 && items[startIndex]?.kind !== "user_message") {
    startIndex -= 1;
  }
  if (!pinnedStartItemId) {
    return startIndex;
  }
  // A pin that has fallen out of the tail entirely is stale - ignore it rather
  // than mounting the whole history.
  const pinnedIndex = items.findIndex((item) => item.id === pinnedStartItemId);
  return pinnedIndex >= 0 ? Math.min(pinnedIndex, startIndex) : startIndex;
}

export function splitWebVirtualizedHistory(input: {
  entries: IndexedStreamItem[];
  minMountedCount: number;
  pinnedStartItemId?: string | null;
}): WebVirtualizedHistoryWindow {
  const startIndex = findMountedWindowStart({
    items: input.entries.map((entry) => entry.item),
    minMountedCount: input.minMountedCount,
    ...(input.pinnedStartItemId ? { pinnedStartItemId: input.pinnedStartItemId } : {}),
  });
  return {
    virtualizedEntries: input.entries.slice(0, startIndex),
    mountedEntries: input.entries.slice(startIndex),
  };
}

export function shouldAdjustScrollForVirtualRowResize(input: {
  isHistoryStartPrependActive: boolean;
  rowStart: number;
  scrollOffset: number;
  remainingDistanceFromBottom: number;
  bottomThreshold: number;
}): boolean {
  if (input.isHistoryStartPrependActive) {
    return false;
  }
  return (
    input.remainingDistanceFromBottom > input.bottomThreshold && input.rowStart < input.scrollOffset
  );
}
