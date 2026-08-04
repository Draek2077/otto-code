import type { StreamItem } from "@/types/stream";
import { estimateAssistantMessageHeightFromCache } from "@/utils/assistant-message-height-estimate";

// Below this many items the whole stream stays mounted: virtualizing a short chat costs
// more in measurement churn than it saves.
export const DEFAULT_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD = 40;
// The tail that is never virtualized, so the live turn and the messages around it keep
// their exact heights and the bottom anchor cannot drift.
//
// Was 50, which made the floor cost of *any* long chat 50 fully rendered markdown bubbles
// no matter how far up the user scrolled - the reason scrolling a long chat was heavy.
// 12 comfortably covers the visible viewport plus the live turn, which is all the tail has
// to do; everything above it goes through the virtualizer like the rest of history.
export const DEFAULT_WEB_MOUNTED_RECENT_STREAM_ITEMS = 12;
// A phone viewport holds a fraction of what a desktop one does, and every mounted
// bubble is markdown that re-renders on the same JS thread the composer types on.
// 8 still covers a phone screen plus the live turn.
export const DEFAULT_WEB_MOBILE_MOUNTED_RECENT_STREAM_ITEMS = 8;
const COLLAPSED_TOOL_SEQUENCE_ROW_HEIGHT_ESTIMATE = 40;
// How far the walk-back below may hunt for the turn's opening user message before it
// settles for a boundary inside the turn instead.
//
// One agentic turn runs for hundreds of rows with no user message anywhere in it, so an
// uncapped walk-back anchors on the line that *started* the turn and mounts the entire
// thing - the tail cap above becomes a no-op during exactly the long streaming runs it
// was reduced for. 40 is wide enough that an ordinary conversational turn still rewinds
// to its user message, which is the shape the walk-back exists for.
const MAX_MOUNTED_WINDOW_WALK_BACK = 40;

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

export function getWebMountedRecentStreamItems(isMobileBreakpoint = false): number {
  const override = readPositiveIntegerOverride(
    (globalThis as BottomAnchorE2ETestGlobals).__OTTO_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS,
  );
  if (override !== null) {
    return override;
  }
  return isMobileBreakpoint
    ? DEFAULT_WEB_MOBILE_MOUNTED_RECENT_STREAM_ITEMS
    : DEFAULT_WEB_MOUNTED_RECENT_STREAM_ITEMS;
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
 * Does the row at `index` begin something, or continue the row above it?
 *
 * Every kind except an assistant block is its own self-contained row - a tool
 * call, a folded action group, a todo list - so the mounted window can start on
 * one without cutting anything in half. Assistant blocks are the exception: a
 * streamed reply is promoted one markdown block at a time into separate rows
 * sharing a `blockGroupId` that butt together into a single visible bubble, and
 * only that group's first block is a place to cut.
 */
function startsAVisualRow(items: StreamItem[], index: number): boolean {
  const item = items[index];
  if (!item) {
    return false;
  }
  if (item.kind !== "assistant_message" || item.blockGroupId === undefined) {
    return true;
  }
  const previous = items[index - 1];
  return !(previous?.kind === "assistant_message" && previous.blockGroupId === item.blockGroupId);
}

/**
 * Where the mounted (real-DOM) window begins. Everything before it is handed to
 * the virtualizer, which renders it from *estimates* until each row is measured.
 *
 * That handoff is destructive to scroll position: a turn worth of measured
 * height is swapped for `estimateStreamItemHeight` in a single frame, the
 * document shrinks by however much the estimates undershoot, and the browser
 * clamps `scrollTop` - dumping a reader who was scrolled up somewhere near the
 * top. The window naturally advances *while the agent streams* (the walk-back
 * anchor jumps from one user message to the next as the tail grows), so this hit
 * lands exactly when someone is reading back through a live turn.
 *
 * `pinnedStartItemId` is the guard: while the reader is scrolled away from the
 * bottom, the caller pins the current boundary and the window only ever holds
 * OPEN (a smaller start mounts more). Nothing already on screen is yanked into
 * the virtualizer under them. The pin releases when they return to the bottom,
 * where the collapse happens above the viewport and is invisible.
 *
 * That same invisibility is why the walk-back is capped **only while following**
 * (no pin). A single agentic turn can hold hundreds of promoted blocks and tool
 * rows without one user message among them, so the walk anchors on the message
 * that opened the turn and the whole turn stays real-DOM-mounted for as long as
 * it streams. While following, the window gives up after
 * `MAX_MOUNTED_WINDOW_WALK_BACK` rows and settles for the nearest boundary
 * inside the turn; the measured-to-estimate collapse that costs lands above the
 * viewport, where nobody sees it. While pinned, the full walk-back stands.
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

  const isFollowing = !pinnedStartItemId;
  const tailStart = Math.max(items.length - minMountedCount, 0);
  // The closest cut inside the turn, held in reserve in case the walk runs out of
  // budget before it finds a user message.
  let turnInternalStart = -1;
  let startIndex = tailStart;
  while (startIndex > 0 && items[startIndex]?.kind !== "user_message") {
    if (isFollowing) {
      if (turnInternalStart < 0 && startsAVisualRow(items, startIndex)) {
        turnInternalStart = startIndex;
      }
      if (tailStart - startIndex >= MAX_MOUNTED_WINDOW_WALK_BACK) {
        return turnInternalStart >= 0 ? turnInternalStart : startIndex;
      }
    }
    startIndex -= 1;
  }
  if (isFollowing) {
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
