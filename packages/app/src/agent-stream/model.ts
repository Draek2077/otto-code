import type { ReactNode } from "react";
import { deriveStreamTurnTiming, type StreamTurnTiming } from "@/timeline/turn-time";
import type { StreamItem } from "@/types/stream";
import {
  findMountedWindowStart,
  getWebMountedRecentStreamItems,
  getWebPartialVirtualizationThreshold,
} from "./web-virtualization";
import { groupConsecutiveActionItems } from "./action-grouping";
import { orderHeadForStreamRenderStrategy, orderTailForStreamRenderStrategy } from "./strategy";
import { resolveStreamRenderStrategy } from "./strategy-resolver";

export interface StreamRenderSegments {
  historyVirtualized: StreamItem[];
  historyMounted: StreamItem[];
  liveHead: StreamItem[];
}

export interface StreamHistoryBoundary {
  hasVirtualizedHistory: boolean;
  hasMountedHistory: boolean;
  hasLiveHead: boolean;
}

export interface StreamRenderAuxiliary {
  pendingPermissions: ReactNode;
  turnFooter: ReactNode;
}

export interface AgentStreamRenderModel {
  history: StreamItem[];
  segments: StreamRenderSegments;
  turnTiming: StreamTurnTiming;
  boundary: StreamHistoryBoundary;
  auxiliary: StreamRenderAuxiliary;
}

export interface BuildAgentStreamRenderModelInput {
  isTurnActive: boolean;
  activeTurnStartedAt: Date | null;
  tail: StreamItem[];
  head: StreamItem[];
  platform: "web" | "native";
  isMobileBreakpoint: boolean;
  /** Index into `tail` marking where the loaded history begins - rows before it
   *  belong to an older page that has not been fetched. */
  historyStart?: number;
  groupConsecutiveActions?: boolean;
  /**
   * Item id of the mounted-window boundary to hold while the reader is scrolled
   * away from the bottom, so a streaming turn can't virtualize the content under
   * them. See findMountedWindowStart.
   */
  pinnedMountedWindowStartId?: string | null;
}

const EMPTY_STREAM_ITEMS: StreamItem[] = [];
const EMPTY_AUXILIARY: StreamRenderAuxiliary = {
  pendingPermissions: null,
  turnFooter: null,
};

// Grouped tails are cached by raw-tail identity so every downstream WeakMap
// cache (ordering, history split, layout) keys off a stable array identity.
const groupedTailCache = new WeakMap<StreamItem[], StreamItem[]>();
const orderedTailCache = new WeakMap<StreamItem[], Map<string, StreamItem[]>>();
const orderedHeadCache = new WeakMap<StreamItem[], Map<string, StreamItem[]>>();
const splitHistoryCache = new WeakMap<
  StreamItem[],
  Map<string, Pick<AgentStreamRenderModel, "history" | "segments">>
>();
const turnTimingCache = new WeakMap<
  StreamItem[],
  WeakMap<StreamItem[], Map<string, StreamTurnTiming>>
>();

function getOrderedItems(params: {
  cache: WeakMap<StreamItem[], Map<string, StreamItem[]>>;
  source: StreamItem[];
  cacheKey: string;
  order: (items: StreamItem[]) => StreamItem[];
}): StreamItem[] {
  const { cache, source, cacheKey, order } = params;
  let cachedByKey = cache.get(source);
  if (!cachedByKey) {
    cachedByKey = new Map();
    cache.set(source, cachedByKey);
  }
  const cached = cachedByKey.get(cacheKey);
  if (cached) {
    return cached;
  }
  const ordered = order(source);
  cachedByKey.set(cacheKey, ordered);
  return ordered;
}

function splitOrderedTail(params: {
  orderedTail: StreamItem[];
  platform: "web" | "native";
  isMobileBreakpoint: boolean;
  pinnedMountedWindowStartId?: string | null;
}): Pick<AgentStreamRenderModel, "history" | "segments"> {
  const { orderedTail, platform, isMobileBreakpoint, pinnedMountedWindowStartId } = params;
  // Native is excluded because FlatList already virtualizes: strategy-native
  // merges both segments back into one `data` array and renders every row the
  // same way, so splitting here would buy nothing and double-virtualizing would
  // wreck its height measurement. Mobile web has no such fallback - it used to
  // be excluded too, which left a phone browser mounting the entire transcript,
  // the heaviest case on the weakest device.
  const shouldSplitHistory =
    platform === "web" && orderedTail.length > getWebPartialVirtualizationThreshold();
  const mountedRecentStreamItems = getWebMountedRecentStreamItems();
  const cacheKey = `${platform}:${isMobileBreakpoint}:${mountedRecentStreamItems}:${shouldSplitHistory}:${pinnedMountedWindowStartId ?? ""}`;
  let cachedByKey = splitHistoryCache.get(orderedTail);
  if (!cachedByKey) {
    cachedByKey = new Map();
    splitHistoryCache.set(orderedTail, cachedByKey);
  }
  const cached = cachedByKey.get(cacheKey);
  if (cached) {
    return cached;
  }

  if (!shouldSplitHistory) {
    const unsplit = {
      history: orderedTail,
      segments: {
        historyVirtualized: EMPTY_STREAM_ITEMS,
        historyMounted: orderedTail,
        liveHead: EMPTY_STREAM_ITEMS,
      },
    } satisfies Pick<AgentStreamRenderModel, "history" | "segments">;
    cachedByKey.set(cacheKey, unsplit);
    return unsplit;
  }

  const mountedWindowStart = findMountedWindowStart({
    items: orderedTail,
    minMountedCount: mountedRecentStreamItems,
    ...(pinnedMountedWindowStartId ? { pinnedStartItemId: pinnedMountedWindowStartId } : {}),
  });
  const split = {
    history: orderedTail,
    segments: {
      historyVirtualized: orderedTail.slice(0, mountedWindowStart),
      historyMounted: orderedTail.slice(mountedWindowStart),
      liveHead: EMPTY_STREAM_ITEMS,
    },
  } satisfies Pick<AgentStreamRenderModel, "history" | "segments">;
  cachedByKey.set(cacheKey, split);
  return split;
}

function getTurnTiming(params: {
  isTurnActive: boolean;
  activeTurnStartedAt: Date | null;
  tail: StreamItem[];
  head: StreamItem[];
}): StreamTurnTiming {
  let cachedByHead = turnTimingCache.get(params.tail);
  if (!cachedByHead) {
    cachedByHead = new WeakMap();
    turnTimingCache.set(params.tail, cachedByHead);
  }
  let cachedByActivity = cachedByHead.get(params.head);
  if (!cachedByActivity) {
    cachedByActivity = new Map();
    cachedByHead.set(params.head, cachedByActivity);
  }
  const activityKey = `${params.isTurnActive}:${params.activeTurnStartedAt?.getTime() ?? "none"}`;
  const cached = cachedByActivity.get(activityKey);
  if (cached) {
    return cached;
  }
  const timing = deriveStreamTurnTiming(params);
  cachedByActivity.set(activityKey, timing);
  return timing;
}

function getGroupedTail(tail: StreamItem[]): StreamItem[] {
  const cached = groupedTailCache.get(tail);
  if (cached) {
    return cached;
  }
  const grouped = groupConsecutiveActionItems(tail);
  groupedTailCache.set(tail, grouped);
  return grouped;
}

export function buildAgentStreamRenderModel(
  input: BuildAgentStreamRenderModelInput,
): AgentStreamRenderModel {
  const strategy = resolveStreamRenderStrategy({
    platform: input.platform === "web" ? "web" : "native",
    isMobileBreakpoint: input.isMobileBreakpoint,
  });
  const orderingCacheKey = `${input.platform}:${input.isMobileBreakpoint}`;
  // The window comes off the chronological tail first, then grouping runs on
  // what survives it: grouping the whole tail and windowing afterwards would
  // both do work on history that is never rendered and let a group straddle
  // the window edge. Grouping stays on the render path only - stores stay
  // ungrouped.
  const renderedTail = input.historyStart ? input.tail.slice(input.historyStart) : input.tail;
  const tailSource = input.groupConsecutiveActions ? getGroupedTail(renderedTail) : renderedTail;
  const orderedTail = getOrderedItems({
    cache: orderedTailCache,
    source: tailSource,
    cacheKey: orderingCacheKey,
    order: (items) =>
      orderTailForStreamRenderStrategy({
        strategy,
        streamItems: items,
      }),
  });
  const orderedHead = getOrderedItems({
    cache: orderedHeadCache,
    source: input.head,
    cacheKey: orderingCacheKey,
    order: (items) =>
      orderHeadForStreamRenderStrategy({
        strategy,
        streamHead: items,
      }),
  });
  const splitHistory = splitOrderedTail({
    orderedTail,
    platform: input.platform,
    isMobileBreakpoint: input.isMobileBreakpoint,
    ...(input.pinnedMountedWindowStartId
      ? { pinnedMountedWindowStartId: input.pinnedMountedWindowStartId }
      : {}),
  });
  const turnTiming = getTurnTiming({
    isTurnActive: input.isTurnActive,
    activeTurnStartedAt: input.activeTurnStartedAt,
    tail: renderedTail,
    head: input.head,
  });

  return {
    history: splitHistory.history,
    segments: {
      ...splitHistory.segments,
      liveHead: orderedHead,
    },
    turnTiming,
    boundary: {
      hasVirtualizedHistory: splitHistory.segments.historyVirtualized.length > 0,
      hasMountedHistory: splitHistory.segments.historyMounted.length > 0,
      hasLiveHead: orderedHead.length > 0,
    },
    auxiliary: EMPTY_AUXILIARY,
  };
}
