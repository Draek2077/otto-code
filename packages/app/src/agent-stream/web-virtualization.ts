import type { StreamItem } from "@/types/stream";
import { estimateAssistantMessageHeightFromCache } from "@/utils/assistant-message-height-estimate";

export const DEFAULT_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD = 100;
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
 * the virtualizer, which renders it from *estimates* until each row is measured.
 *
 * That handoff is destructive to scroll position: a turn worth of measured
 * height is swapped for `estimateStreamItemHeight` in a single frame, the
 * document shrinks by however much the estimates undershoot, and the browser
 * clamps `scrollTop` — dumping a reader who was scrolled up somewhere near the
 * top. The window naturally advances *while the agent streams* (the walk-back
 * anchor jumps from one user message to the next as the tail grows), so this hit
 * lands exactly when someone is reading back through a live turn.
 *
 * `pinnedStartItemId` is the guard: while the reader is scrolled away from the
 * bottom, the caller pins the current boundary and the window only ever holds
 * OPEN (a smaller start mounts more). Nothing already on screen is yanked into
 * the virtualizer under them. The pin releases when they return to the bottom,
 * where the collapse happens above the viewport and is invisible.
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
  // A pin that has fallen out of the tail entirely is stale — ignore it rather
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
