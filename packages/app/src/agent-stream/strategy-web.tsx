import React, {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActivityIndicator } from "react-native";
import { measureElement as measureVirtualElement, useVirtualizer } from "@tanstack/react-virtual";
import { estimateStreamItemHeight, shouldAbsorbVirtualRowResize } from "./web-virtualization";
import type { StreamRenderInput, StreamStrategy, StreamViewportHandle } from "./strategy";
import { createStreamStrategy } from "./strategy";
import {
  createHistoryStartPaginationState,
  evaluateHistoryStartPagination,
  HISTORY_START_THRESHOLD_PX,
  rearmHistoryStartPagination,
} from "./history-start-pagination";

interface CreateWebStreamStrategyInput {
  isMobileBreakpoint: boolean;
}

type ScrollBehaviorLike = "auto" | "smooth";

const WEB_BOTTOM_SETTLE_TIMEOUT_MS = 200;
const USER_SCROLL_DELTA_EPSILON = 1;
const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 64;
const AUTO_SCROLL_RESUME_THRESHOLD_PX = 1;
// Overscroll is a real state (elastic scrolling, `overscroll-behavior: contain`)
// and the stick refuses to fight it. But `scrollTop` is fractional while
// `clientHeight`/`scrollHeight` are integers, so at any display scale or browser
// zoom that is not 100% the distance from the bottom sits permanently a fraction
// below zero. Read literally, that made `scheduleStickToBottom` and
// `scrollMessagesToBottom` no-ops for the whole session: the transcript stopped
// following, and the jump-to-bottom button did nothing on the first press.
// Windows at 125%/150% display scaling hits this every time.
const BOTTOM_OVERSCROLL_TOLERANCE_PX = 2;
const SCROLL_ANCHOR_DRIFT_EPSILON_PX = 0.5;
// Marks the virtualizer's block so the scroll anchor skips it: its rows are
// absolutely positioned off a running total that moves as they are measured, and
// the virtualizer compensates scrollTop for that itself. Anchoring to it would
// count the same correction twice.
const VIRTUALIZED_BLOCK_ATTRIBUTE = "data-stream-virtualized-block";
import { useWebElementScrollbar } from "@/components/use-web-scrollbar";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useHasFinePointer } from "@/hooks/use-fine-pointer";
import { useStableEvent } from "@/hooks/use-stable-event";
import { deriveVisibilityScrollRestoration } from "./visibility-scroll-restoration";

const historyStartSlotStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 32,
  paddingTop: 4,
  paddingBottom: 8,
};

// Mirrors the virtual-row wrapper (flex column, full width) minus the absolute
// positioning, so a row's box - including alignSelf alignment and vertical
// margins - lays out identically on both sides of the mounted/virtualized
// boundary, and a height measured here is the height the virtualizer will see.
const mountedRowWrapperStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "100%",
};

/**
 * A row that is currently on screen, plus where it sits **in the content**.
 * While the reader is detached this is the fixed point the whole transcript is
 * held against: the document can grow, shrink, fold a run of tool calls into a
 * group and unfold it again, and the anchored row stays exactly where their eyes
 * are.
 *
 * Content space, not viewport space, and that is the whole point. A row's
 * viewport-relative top is `contentRelativeTop - scrollTop`, so the reader
 * scrolling and the content reflowing move it by exactly the same kind of
 * number, and a correction computed from it cannot tell the two apart. It does
 * not have the information. `contentRelativeTop` is independent of `scrollTop`
 * by construction, so the reader can move as much as they like and the measured
 * drift stays zero.
 *
 * That distinction has to be structural rather than inferred, because the app
 * cannot win the race that decides it: this is corrected from a layout effect,
 * which React runs synchronously at commit, while the scroll event that would
 * report the reader's movement is dispatched asynchronously afterwards. A
 * viewport-space anchor therefore saw the reader's own scroll as drift and wrote
 * it straight back, one frame before `handleDomScroll` could re-capture. The
 * restored value then matched `programmaticScrollTopRef`, so the handler read
 * the reader's movement as the app's own echo and never refreshed the anchor:
 * the transcript pinned itself at the moment of detach and could not be scrolled
 * again. See docs/chat-scrolling.md.
 *
 * Still measured through `getBoundingClientRect` against the scroll container
 * rather than `offsetTop`, so that the container moving on screen (the mobile
 * keyboard opening) cancels out instead of registering as drift.
 */
interface ScrollAnchor {
  element: HTMLElement;
  contentRelativeTop: number;
}

function measureViewportRelativeTop(scrollContainer: HTMLElement, element: HTMLElement): number {
  return element.getBoundingClientRect().top - scrollContainer.getBoundingClientRect().top;
}

function measureContentRelativeTop(scrollContainer: HTMLElement, element: HTMLElement): number {
  return measureViewportRelativeTop(scrollContainer, element) + scrollContainer.scrollTop;
}

function findScrollAnchor(scrollContainer: HTMLElement, content: HTMLElement): ScrollAnchor | null {
  const containerTop = scrollContainer.getBoundingClientRect().top;
  const viewportHeight = scrollContainer.clientHeight;
  for (const child of Array.from(content.children)) {
    if (!(child instanceof HTMLElement)) {
      continue;
    }
    if (child.hasAttribute(VIRTUALIZED_BLOCK_ATTRIBUTE)) {
      continue;
    }
    const rect = child.getBoundingClientRect();
    const relativeTop = rect.top - containerTop;
    if (relativeTop + rect.height <= 0) {
      continue;
    }
    if (relativeTop >= viewportHeight) {
      break;
    }
    return { element: child, contentRelativeTop: relativeTop + scrollContainer.scrollTop };
  }
  return null;
}

function isScrollContainerNearBottom(
  scrollContainer: Pick<HTMLElement, "scrollTop" | "clientHeight" | "scrollHeight">,
  thresholdPx = AUTO_SCROLL_BOTTOM_THRESHOLD_PX,
): boolean {
  const threshold = Number.isFinite(thresholdPx)
    ? Math.max(0, thresholdPx)
    : AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
  const { scrollTop, clientHeight, scrollHeight } = scrollContainer;
  if (![scrollTop, clientHeight, scrollHeight].every(Number.isFinite)) {
    return true;
  }
  const distanceFromBottom = scrollHeight - clientHeight - scrollTop;
  return distanceFromBottom <= threshold;
}

function isScrollContainerAtBottom(
  scrollContainer: Pick<HTMLElement, "scrollTop" | "clientHeight" | "scrollHeight">,
): boolean {
  return isScrollContainerNearBottom(scrollContainer, AUTO_SCROLL_RESUME_THRESHOLD_PX);
}

function scrollElementToBottom(
  scrollContainer: HTMLElement,
  behavior: ScrollBehaviorLike = "auto",
): void {
  scrollContainer.scrollTo({
    top: scrollContainer.scrollHeight,
    behavior,
  });
}

function getScrollContainerDistanceFromBottom(
  scrollContainer: Pick<HTMLElement, "scrollTop" | "clientHeight" | "scrollHeight">,
): number {
  return scrollContainer.scrollHeight - scrollContainer.clientHeight - scrollContainer.scrollTop;
}

function isScrollContainerOverscrolledPastBottom(
  scrollContainer: Pick<HTMLElement, "scrollTop" | "clientHeight" | "scrollHeight">,
): boolean {
  return getScrollContainerDistanceFromBottom(scrollContainer) < -BOTTOM_OVERSCROLL_TOLERANCE_PX;
}

function WebStreamViewport(props: StreamRenderInput & { isMobileBreakpoint: boolean }) {
  const {
    segments,
    boundary,
    renderers,
    listEmptyComponent,
    viewportRef,
    routeBottomAnchorRequest,
    isAuthoritativeHistoryReady,
    onNearBottomChange,
    onNearHistoryStart,
    isLoadingOlderHistory,
    hasOlderHistory,
    olderHistoryProgressKey,
    liveHeadRowRevision,
    scrollEnabled,
    isMobileBreakpoint,
  } = props;
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const handleScrollContainerRef = useCallback((node: HTMLElement | null) => {
    scrollContainerRef.current = node;
  }, []);
  const handleContentRef = useCallback((node: HTMLElement | null) => {
    contentRef.current = node;
  }, []);
  // Needed to place a resized virtual row against the viewport: the virtualizer
  // reports row offsets from the top of its own block, not from the top of the
  // scrollable content.
  const virtualizedBlockRef = useRef<HTMLElement | null>(null);
  const handleVirtualizedBlockRef = useCallback((node: HTMLElement | null) => {
    virtualizedBlockRef.current = node;
  }, []);
  const [followOutput, setFollowOutputr] = useState(true);
  const followOutputRef = useRef(followOutput);
  const isPaneVisible = useRetainedPanelActive();
  const isPaneVisibleRef = useRef(isPaneVisible);
  const wasPaneVisibleRef = useRef(isPaneVisible);
  const lastVisibleScrollTopRef = useRef(0);
  const setFollowOutput = (value: boolean) => {
    followOutputRef.current = value;
    setFollowOutputr(value);
    return value;
  };
  const lastKnownScrollTopRef = useRef(0);
  const lastScrollHeightRef = useRef(0);
  const lastClientHeightRef = useRef(0);
  /**
   * Real heights for every row that is (or ever was) mounted, keyed by item id,
   * refreshed each commit. `estimateSize` consults this before falling back to
   * `estimateStreamItemHeight`, which makes the mounted-to-virtualized handoff
   * **lossless**: when the boundary advances or the pin releases, the rows the
   * virtualizer takes over keep the exact heights they had in the real DOM, so
   * the document does not shrink, `scrollTop` is not clamped, and there is no
   * estimate-to-measured growth to re-absorb afterwards.
   *
   * That collapse was the root of the worst family of bugs here: the clamp's
   * scroll event could be misread as the reader scrolling up (detaching them to
   * the top of a live chat with no input), and the jump-to-bottom button
   * re-triggered the same collapse on every press via the pin release, undoing
   * itself. Eliminating the height loss removes the cause rather than
   * compensating for the effect.
   */
  const measuredRowHeightsRef = useRef(new Map<string, number>());
  const mountedRowElementsRef = useRef(new Map<string, HTMLElement>());
  // The scrollTop the app itself just wrote. The scroll event it produces is the
  // app's own echo, not the reader moving the view, and must not be read as
  // intent in either direction.
  const programmaticScrollTopRef = useRef<number | null>(null);
  const scrollAnchorRef = useRef<ScrollAnchor | null>(null);
  const lastTouchClientYRef = useRef<number | null>(null);
  const pendingAutoScrollFrameRef = useRef<number | null>(null);
  const pendingAutoScrollTimeoutRef = useRef<number | null>(null);
  const pendingVirtualRowMeasureFramesRef = useRef(new Map<Element, number>());
  const historyStartReadyRef = useRef(false);
  const historyStartPaginationStateRef = useRef(createHistoryStartPaginationState());
  const lastActivationKeyRef = useRef<string | null>(null);
  // Overlay scrollbar follows the pointer capability, not the breakpoint: a
  // narrow desktop window still has a mouse, a full-width phone browser doesn't.
  const showDesktopWebScrollbar = useHasFinePointer();
  const scrollbarOverlay = useWebElementScrollbar(scrollContainerRef, {
    enabled: showDesktopWebScrollbar,
    contentRef,
  });
  const shouldUseVirtualizer = segments.historyVirtualized.length > 0;
  const {
    renderHistoryVirtualizedRow,
    renderHistoryMountedRow,
    renderLiveHeadRow,
    renderLiveAuxiliary,
  } = renderers;

  followOutputRef.current = followOutput;
  isPaneVisibleRef.current = isPaneVisible;

  const hasRouteBottomAnchorRequest = routeBottomAnchorRequest !== null;
  const activationKey = routeBottomAnchorRequest?.requestKey ?? props.agentId;
  const isActivationReady = !hasRouteBottomAnchorRequest || isAuthoritativeHistoryReady;

  const rowVirtualizer = useVirtualizer({
    count: segments.historyVirtualized.length,
    enabled: shouldUseVirtualizer,
    getScrollElement: () => scrollContainerRef.current,
    getItemKey: (index: number) => segments.historyVirtualized[index]?.id ?? index,
    estimateSize: (index: number) => {
      const row = segments.historyVirtualized[index];
      if (!row) {
        return 120;
      }
      return measuredRowHeightsRef.current.get(row.id) ?? estimateStreamItemHeight(row);
    },
    measureElement: measureVirtualElement,
    useAnimationFrameWithResizeObserver: true,
    overscan: 8,
  });
  useEffect(() => {
    // Overriding this replaces TanStack's default guard entirely, so the
    // "is the row above the reader" test has to be restored here rather than
    // inherited. See shouldAbsorbVirtualRowResize for what dropping it costs, in
    // both the detached and the following state.
    rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item) => {
      const scrollContainer = scrollContainerRef.current;
      const virtualizedBlock = virtualizedBlockRef.current;
      if (!scrollContainer || !virtualizedBlock) {
        return false;
      }
      // One owner per correction. While detached with a live anchor, the anchor
      // measures the anchored row's real position after every commit and cancels
      // whatever the virtualized block above it did - so absorbing here too
      // would count the same growth twice, and the double-write walked the
      // reader to the top of the transcript one measurement batch at a time.
      // The absorb stays on when the anchor cannot see (following, where the
      // anchor is always null, and detached deep in virtualized territory where
      // no mounted row is on screen).
      if (!followOutputRef.current && scrollAnchorRef.current !== null) {
        return false;
      }
      return shouldAbsorbVirtualRowResize({
        blockViewportRelativeTop: measureViewportRelativeTop(scrollContainer, virtualizedBlock),
        rowStart: item.start,
      });
    };
    return () => {
      rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
    };
  }, [rowVirtualizer]);
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualTotalSize = rowVirtualizer.getTotalSize();

  const measureVirtualizedRowElement = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) {
        rowVirtualizer.measureElement(null);
        return;
      }
      const pendingFrames = pendingVirtualRowMeasureFramesRef.current;
      const existingFrame = pendingFrames.get(node);
      if (existingFrame !== undefined) {
        window.cancelAnimationFrame(existingFrame);
      }
      const frame = window.requestAnimationFrame(() => {
        pendingFrames.delete(node);
        if (node.isConnected) {
          rowVirtualizer.measureElement(node);
        }
      });
      pendingFrames.set(node, frame);
    },
    [rowVirtualizer],
  );

  useEffect(() => {
    const pendingFrames = pendingVirtualRowMeasureFramesRef.current;
    return () => {
      for (const frame of pendingFrames.values()) {
        window.cancelAnimationFrame(frame);
      }
      pendingFrames.clear();
    };
  }, []);

  const cancelPendingStickToBottom = useCallback(() => {
    const pendingFrame = pendingAutoScrollFrameRef.current;
    if (pendingFrame !== null) {
      pendingAutoScrollFrameRef.current = null;
      window.cancelAnimationFrame(pendingFrame);
    }
    const pendingTimeout = pendingAutoScrollTimeoutRef.current;
    if (pendingTimeout !== null) {
      pendingAutoScrollTimeoutRef.current = null;
      window.clearTimeout(pendingTimeout);
    }
  }, []);

  // Near-bottom is reported as "the app is following the output", not merely "the
  // scrollTop happens to be close to the end". A reader who nudged the view up by
  // ten pixels is reading, so the jump-to-bottom affordance appears and the
  // mounted-window pin engages even though they are still inside the 64px band.
  const updateScrollMetrics = useCallback(() => {
    if (!isPaneVisibleRef.current) {
      return;
    }
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      onNearBottomChange(true);
      return;
    }
    onNearBottomChange(followOutputRef.current && isScrollContainerNearBottom(scrollContainer));
  }, [onNearBottomChange]);

  /**
   * Ask for the previous page of history, at most once per page that arrives.
   *
   * This used to be a bare `scrollTop <= 96` test inside the scroll handler, so
   * it fired on *every* scroll event in that band. Each request splices content
   * in above the reader, and near the top of a transcript there is nothing to
   * hold them: the anchor skips the virtualizer's block and every mounted row is
   * below the fold, so `findScrollAnchor` returns null by design. The result was
   * a burst of pages and a reader thrown to the top.
   *
   * `olderHistoryProgressKey` changes once per page delivered, which is what
   * makes "once per page" expressible at all: the request is recorded against
   * the key it was made from and is not repeated until a new page moves it.
   *
   * Requesting data is not a scroll write, so this sits outside the rule in
   * docs/chat-scrolling.md. The position is untouched either way, and follow /
   * detach state is read but never changed.
   */
  const evaluateHistoryStart = useStableEvent(() => {
    if (!isPaneVisibleRef.current) {
      return;
    }
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }
    // While the app is still driving itself to the bottom, its scrollTop is in
    // transit and means nothing about where the reader is.
    const bottomAnchorSettled =
      !followOutputRef.current || isScrollContainerNearBottom(scrollContainer);
    const result = evaluateHistoryStartPagination(historyStartPaginationStateRef.current, {
      distanceFromHistoryStart: scrollContainer.scrollTop,
      hasOlderHistory,
      isLoadingOlderHistory,
      isReady: historyStartReadyRef.current && bottomAnchorSettled,
      progressKey: olderHistoryProgressKey,
    });
    historyStartPaginationStateRef.current = result.state;
    if (result.shouldLoad) {
      onNearHistoryStart();
    }
  });

  const noteProgrammaticScroll = useCallback((scrollContainer: HTMLElement) => {
    programmaticScrollTopRef.current = scrollContainer.scrollTop;
    lastKnownScrollTopRef.current = scrollContainer.scrollTop;
    lastScrollHeightRef.current = scrollContainer.scrollHeight;
    lastClientHeightRef.current = scrollContainer.clientHeight;
    if (isPaneVisibleRef.current) {
      lastVisibleScrollTopRef.current = scrollContainer.scrollTop;
    }
  }, []);

  const captureScrollAnchor = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    const content = contentRef.current;
    if (!scrollContainer || !content || followOutputRef.current) {
      scrollAnchorRef.current = null;
      return;
    }
    scrollAnchorRef.current = findScrollAnchor(scrollContainer, content);
  }, []);

  /**
   * The only scroll write the app makes while detached, and it exists purely to
   * cancel motion out: whatever the last commit did to the document above the
   * anchored row is subtracted back off so the reader's view does not move.
   *
   * The drift it acts on is measured in content space, so movement the *reader*
   * caused contributes exactly zero to it and this writes nothing at all. Only
   * the document reflowing above the anchor can produce a correction.
   */
  const restoreScrollAnchor = useCallback(() => {
    if (followOutputRef.current || !isPaneVisibleRef.current) {
      return;
    }
    const scrollContainer = scrollContainerRef.current;
    const anchor = scrollAnchorRef.current;
    if (!scrollContainer || !anchor) {
      return;
    }
    if (!anchor.element.isConnected) {
      captureScrollAnchor();
      return;
    }
    const contentRelativeTop = measureContentRelativeTop(scrollContainer, anchor.element);
    const drift = contentRelativeTop - anchor.contentRelativeTop;
    if (Math.abs(drift) < SCROLL_ANCHOR_DRIFT_EPSILON_PX) {
      return;
    }
    // Consume the drift into the baseline whether or not the write lands whole:
    // at the very top or bottom of the range the browser clamps it, and a
    // remainder kept around would re-fire on every subsequent commit. Scrolling
    // cannot change a content-space position, so this is only ever settling the
    // reflow that was just observed.
    anchor.contentRelativeTop = contentRelativeTop;
    scrollContainer.scrollTop += drift;
    noteProgrammaticScroll(scrollContainer);
  }, [captureScrollAnchor, noteProgrammaticScroll]);

  const scrollMessagesToBottom = useCallback(
    (behavior: ScrollBehaviorLike = "auto") => {
      const scrollContainer = scrollContainerRef.current;
      if (!scrollContainer || !followOutputRef.current || !isPaneVisibleRef.current) {
        return;
      }
      if (isScrollContainerOverscrolledPastBottom(scrollContainer)) {
        return;
      }
      scrollElementToBottom(scrollContainer, behavior);
      noteProgrammaticScroll(scrollContainer);
      updateScrollMetrics();
      evaluateHistoryStart();
    },
    [evaluateHistoryStart, noteProgrammaticScroll, updateScrollMetrics],
  );

  const scheduleStickToBottom = useCallback(() => {
    if (!isPaneVisibleRef.current) {
      return;
    }
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer && isScrollContainerOverscrolledPastBottom(scrollContainer)) {
      return;
    }
    if (pendingAutoScrollFrameRef.current !== null) {
      return;
    }
    pendingAutoScrollFrameRef.current = window.requestAnimationFrame(() => {
      pendingAutoScrollFrameRef.current = null;
      if (!followOutputRef.current || !isPaneVisibleRef.current) {
        return;
      }
      scrollMessagesToBottom("auto");
    });
  }, [scrollMessagesToBottom]);

  const forceStickToBottom = useCallback(() => {
    cancelPendingStickToBottom();
    scrollMessagesToBottom("auto");
    scheduleStickToBottom();
  }, [cancelPendingStickToBottom, scheduleStickToBottom, scrollMessagesToBottom]);

  const handleDomScroll = useCallback(() => {
    if (!isPaneVisibleRef.current) {
      return;
    }
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }

    const currentScrollTop = scrollContainer.scrollTop;
    const currentScrollHeight = scrollContainer.scrollHeight;
    const currentClientHeight = scrollContainer.clientHeight;
    const previousScrollTop = lastKnownScrollTopRef.current;
    const previousScrollHeight = lastScrollHeightRef.current;
    const previousClientHeight = lastClientHeightRef.current;
    lastKnownScrollTopRef.current = currentScrollTop;
    lastScrollHeightRef.current = currentScrollHeight;
    lastClientHeightRef.current = currentClientHeight;
    lastVisibleScrollTopRef.current = currentScrollTop;

    const programmaticScrollTop = programmaticScrollTopRef.current;
    programmaticScrollTopRef.current = null;
    const isProgrammatic =
      programmaticScrollTop !== null &&
      Math.abs(currentScrollTop - programmaticScrollTop) <= USER_SCROLL_DELTA_EPSILON;
    // A document that shrinks, or a viewport that grows, drags scrollTop down by
    // itself: the browser clamping the range, not the reader scrolling up. That
    // is the whole reason this used to need wheel and touch listeners to tell the
    // two apart, and the reason dragging the overlay scrollbar (which is a
    // separate element and fires neither) never detached.
    const maxInvoluntaryDrop =
      Math.max(0, previousScrollHeight - currentScrollHeight) +
      Math.max(0, currentClientHeight - previousClientHeight);
    const delta = currentScrollTop - previousScrollTop;
    const isInvoluntaryDrop = delta < 0 && -delta <= maxInvoluntaryDrop + USER_SCROLL_DELTA_EPSILON;
    // The bound above compares against the *last recorded* metrics, and scroll
    // events coalesce: several writes and clamps can land between two events,
    // leaving the recorded scrollHeight stale and the drop looking larger than
    // any single shrink allows. The landing state disambiguates what the deltas
    // cannot: a downward move that ends a shrink at the exact bottom of the
    // document is the browser clamping to a smaller range - a reader scrolling
    // up ends *away* from the bottom, or the document did not shrink.
    const isShrinkClampAtBottom =
      delta < 0 &&
      currentScrollHeight < previousScrollHeight &&
      isScrollContainerAtBottom(scrollContainer);
    const isUserScroll = !isProgrammatic && !isInvoluntaryDrop && !isShrinkClampAtBottom;

    // Re-arm on the way *into* the threshold band, not on every upward event
    // inside it. Paseo re-arms from `wheel`, which both misses the overlay
    // scrollbar (a separate element that fires no wheel or touch) and re-fires
    // per tick, leaving only the in-flight-load guard between it and the request
    // burst this whole state machine exists to stop. Above the band there is
    // nothing to request, so clearing there costs nothing; inside it, the
    // progress key is what decides, and one page arrives per request.
    if (
      isUserScroll &&
      delta < -USER_SCROLL_DELTA_EPSILON &&
      !isLoadingOlderHistory &&
      currentScrollTop > HISTORY_START_THRESHOLD_PX
    ) {
      historyStartPaginationStateRef.current = rearmHistoryStartPagination(
        historyStartPaginationStateRef.current,
      );
    }

    if (followOutputRef.current) {
      // Whatever moved the view up (wheel, touch, the overlay scrollbar thumb,
      // Page Up, find-in-page), the reader is reading. From here the app writes
      // nothing until they ask for the bottom again.
      if (isUserScroll && delta < -USER_SCROLL_DELTA_EPSILON) {
        cancelPendingStickToBottom();
        setFollowOutput(false);
        captureScrollAnchor();
      }
    } else if (
      isUserScroll &&
      delta > USER_SCROLL_DELTA_EPSILON &&
      isScrollContainerAtBottom(scrollContainer)
    ) {
      scrollAnchorRef.current = null;
      setFollowOutput(true);
    } else {
      captureScrollAnchor();
    }

    updateScrollMetrics();
    evaluateHistoryStart();
  }, [
    cancelPendingStickToBottom,
    captureScrollAnchor,
    evaluateHistoryStart,
    isLoadingOlderHistory,
    updateScrollMetrics,
  ]);

  useEffect(() => {
    historyStartPaginationStateRef.current = createHistoryStartPaginationState();
    const frame = window.requestAnimationFrame(() => {
      historyStartReadyRef.current = true;
      evaluateHistoryStart();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      historyStartReadyRef.current = false;
    };
  }, [evaluateHistoryStart, props.agentId]);

  // A transcript shorter than its viewport never produces a scroll event, so a
  // first page that does not fill the window - a tall viewport, a short page, a
  // collapsed run of turns - would otherwise leave older history unrequested
  // with no scrollbar to ask for it, and the reader sees a conversation that
  // starts in the middle of itself. Re-evaluated on every content change:
  // `scrollTop` is 0 in that state, which is inside the threshold, and the
  // progress key stops it from asking twice for the same page.
  useEffect(() => {
    evaluateHistoryStart();
  }, [
    evaluateHistoryStart,
    hasOlderHistory,
    isLoadingOlderHistory,
    olderHistoryProgressKey,
    segments.historyMounted.length,
    segments.historyVirtualized.length,
    segments.liveHead.length,
  ]);

  useLayoutEffect(() => {
    if (!isActivationReady) {
      return;
    }
    const isRepeatActivation = lastActivationKeyRef.current === activationKey;
    lastActivationKeyRef.current = activationKey;
    // Entering a chat anchors it at the bottom. Re-running for an activation
    // that already happened must not: this effect fires again on readiness and
    // on any dependency churn, and a detached reader would be yanked each time.
    if (!followOutputRef.current && (hasRouteBottomAnchorRequest || isRepeatActivation)) {
      return;
    }
    setFollowOutput(true);
    forceStickToBottom();
    const timeout = window.setTimeout(() => {
      if (!followOutputRef.current) {
        return;
      }
      const scrollContainer = scrollContainerRef.current;
      if (!scrollContainer) {
        return;
      }
      if (isScrollContainerNearBottom(scrollContainer)) {
        return;
      }
      scheduleStickToBottom();
    }, WEB_BOTTOM_SETTLE_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    activationKey,
    forceStickToBottom,
    hasRouteBottomAnchorRequest,
    isActivationReady,
    scheduleStickToBottom,
  ]);

  useLayoutEffect(() => {
    const wasPaneVisible = wasPaneVisibleRef.current;
    wasPaneVisibleRef.current = isPaneVisible;
    const restoration = deriveVisibilityScrollRestoration({
      wasVisible: wasPaneVisible,
      isVisible: isPaneVisible,
      followsOutput: followOutputRef.current,
    });
    if (restoration === "none") {
      return;
    }
    if (restoration === "stick-to-bottom") {
      forceStickToBottom();
      return;
    }
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }
    scrollContainer.scrollTop = lastVisibleScrollTopRef.current;
    noteProgrammaticScroll(scrollContainer);
    captureScrollAnchor();
    updateScrollMetrics();
  }, [
    captureScrollAnchor,
    forceStickToBottom,
    isPaneVisible,
    noteProgrammaticScroll,
    updateScrollMetrics,
  ]);

  useEffect(() => {
    if (!followOutputRef.current) {
      return;
    }
    scheduleStickToBottom();
  }, [
    scheduleStickToBottom,
    segments.historyMounted,
    segments.historyVirtualized,
    segments.liveHead,
  ]);

  useEffect(() => {
    if (!followOutputRef.current || !shouldUseVirtualizer) {
      return;
    }
    scheduleStickToBottom();
  }, [scheduleStickToBottom, shouldUseVirtualizer, virtualTotalSize]);

  useEffect(() => {
    updateScrollMetrics();
  }, [
    segments.historyMounted.length,
    segments.historyVirtualized.length,
    segments.liveHead.length,
    updateScrollMetrics,
    virtualTotalSize,
  ]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const contentNode = contentRef.current;
    if (!scrollContainer || typeof ResizeObserver === "undefined") {
      return;
    }

    updateScrollMetrics();
    const observer = new ResizeObserver(() => {
      if (!isPaneVisibleRef.current) {
        return;
      }
      // A window growing taller can un-fill a transcript that used to overflow,
      // which is the other way to end up with no scroll event and unrequested
      // history.
      evaluateHistoryStart();
      if (!followOutputRef.current) {
        // A bubble growing as its markdown settles, an image finally loading, the
        // mobile keyboard resizing the viewport: none of it may move the reader.
        restoreScrollAnchor();
        updateScrollMetrics();
        return;
      }
      updateScrollMetrics();
      scheduleStickToBottom();
    });
    observer.observe(scrollContainer);
    if (contentNode) {
      observer.observe(contentNode);
    }
    return () => {
      observer.disconnect();
    };
  }, [evaluateHistoryStart, restoreScrollAnchor, scheduleStickToBottom, updateScrollMetrics]);

  // After every commit, before paint. Whatever that render did to the document
  // above the anchored row (a run of actions folding into a group, a group
  // unfolding, older history splicing in, a virtualized row swapping its
  // estimate for its measured height) is corrected out before the reader can
  // see it move. Deliberately dependency-free: the trigger is "the DOM changed",
  // not any particular prop.
  //
  // The height cache refreshes in the same pass: layout is final at this point,
  // so the wrapper rects are the truth the virtualizer must reproduce when
  // these rows are handed over.
  useLayoutEffect(() => {
    for (const [id, element] of mountedRowElementsRef.current) {
      if (!element.isConnected) {
        continue;
      }
      const height = element.getBoundingClientRect().height;
      if (height > 0) {
        measuredRowHeightsRef.current.set(id, height);
      }
    }
    restoreScrollAnchor();
  });

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }

    // Detaching is decided in the scroll handler, which sees every input device.
    // These two exist only to kill a queued stick on the same frame the gesture
    // starts, so it cannot land in the gap before the scroll event arrives.
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        cancelPendingStickToBottom();
      }
    };
    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      lastTouchClientYRef.current = touch.clientY;
    };
    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      const previousTouchY = lastTouchClientYRef.current;
      if (previousTouchY !== null && touch.clientY > previousTouchY + 1) {
        cancelPendingStickToBottom();
      }
      lastTouchClientYRef.current = touch.clientY;
    };
    const handleTouchEnd = () => {
      lastTouchClientYRef.current = null;
    };

    scrollContainer.addEventListener("scroll", handleDomScroll, { passive: true });
    scrollContainer.addEventListener("wheel", handleWheel, { passive: true });
    scrollContainer.addEventListener("touchstart", handleTouchStart, { passive: true });
    scrollContainer.addEventListener("touchmove", handleTouchMove, { passive: true });
    scrollContainer.addEventListener("touchend", handleTouchEnd, { passive: true });
    scrollContainer.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      scrollContainer.removeEventListener("scroll", handleDomScroll);
      scrollContainer.removeEventListener("wheel", handleWheel);
      scrollContainer.removeEventListener("touchstart", handleTouchStart);
      scrollContainer.removeEventListener("touchmove", handleTouchMove);
      scrollContainer.removeEventListener("touchend", handleTouchEnd);
      scrollContainer.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [cancelPendingStickToBottom, handleDomScroll]);

  useEffect(() => {
    const handle: StreamViewportHandle = {
      scrollToBottom: () => {
        scrollAnchorRef.current = null;
        setFollowOutput(true);
        cancelPendingStickToBottom();
        forceStickToBottom();
      },
      prepareForViewportChange: () => {
        if (!followOutputRef.current) {
          return;
        }
        scheduleStickToBottom();
      },
    };
    viewportRef.current = handle;
    return () => {
      if (viewportRef.current === handle) {
        viewportRef.current = null;
      }
      cancelPendingStickToBottom();
    };
  }, [cancelPendingStickToBottom, forceStickToBottom, scheduleStickToBottom, viewportRef]);

  const contentContainerStyle = useMemo((): CSSProperties => {
    return {
      display: "flex",
      flexDirection: "column",
      minHeight: "100%",
      paddingTop: 16,
      paddingBottom: 16,
      paddingLeft: isMobileBreakpoint ? 8 : 16,
      paddingRight: isMobileBreakpoint ? 8 : 16,
      boxSizing: "border-box",
    };
  }, [isMobileBreakpoint]);
  const scrollContainerStyle = useMemo((): CSSProperties => {
    return {
      flex: 1,
      minHeight: 0,
      overflowX: "hidden",
      overflowY: scrollEnabled ? "auto" : "hidden",
      overscrollBehaviorY: "contain",
    };
  }, [scrollEnabled]);
  const virtualRowsContainerStyle = useMemo((): CSSProperties => {
    return {
      position: "relative",
      width: "100%",
      height: virtualTotalSize,
    };
  }, [virtualTotalSize]);
  const renderVirtualRowStyle = useCallback(
    (start: number): CSSProperties => ({
      position: "absolute",
      top: 0,
      left: 0,
      display: "flex",
      flexDirection: "column",
      width: "100%",
      transform: `translateY(${start}px)`,
    }),
    [],
  );
  // Rows are wrapped in a plain flex-column div (the in-flow twin of the
  // virtual-row wrapper) so each one has a DOM handle to measure into the
  // height cache. The element map drops an entry when its row unmounts; the
  // *height* deliberately survives unmounting - a row leaving the mounted
  // window is exactly the moment its cached height starts mattering.
  const mountedRowRefCallbacksRef = useRef(new Map<string, (node: HTMLElement | null) => void>());
  const getMountedRowRefCallback = useCallback((id: string) => {
    const callbacks = mountedRowRefCallbacksRef.current;
    let callback = callbacks.get(id);
    if (!callback) {
      callback = (node: HTMLElement | null) => {
        if (node) {
          mountedRowElementsRef.current.set(id, node);
        } else {
          mountedRowElementsRef.current.delete(id);
        }
      };
      callbacks.set(id, callback);
    }
    return callback;
  }, []);
  const mountedHistoryRows = useMemo(() => {
    return segments.historyMounted.map((item, index) => (
      <div key={item.id} style={mountedRowWrapperStyle} ref={getMountedRowRefCallback(item.id)}>
        {renderHistoryMountedRow(item, index, segments.historyMounted)}
      </div>
    ));
  }, [getMountedRowRefCallback, renderHistoryMountedRow, segments.historyMounted]);
  // `liveHeadRowRevision` carries the set of tool-call groups the reader has
  // opened. Expanding one changes no item and no array identity, so without it
  // in the dependency list this memo returns the cached rows and the group does
  // not open until an unrelated commit happens to invalidate it - at which point
  // the height changes under a reader who asked for it several seconds ago.
  const liveHeadRows = useMemo(() => {
    void liveHeadRowRevision;
    return segments.liveHead.map((item, index) => (
      <div key={item.id} style={mountedRowWrapperStyle} ref={getMountedRowRefCallback(item.id)}>
        {renderLiveHeadRow(item, index, segments.liveHead)}
      </div>
    ));
  }, [getMountedRowRefCallback, liveHeadRowRevision, renderLiveHeadRow, segments.liveHead]);
  const liveAuxiliary = useMemo(() => {
    return renderLiveAuxiliary();
  }, [renderLiveAuxiliary]);
  // Reserved while there is anything left to load, not just while a load is in
  // flight. Rendering it only during the fetch toggled ~44px in and out at the
  // very top of the content on every page, which is height churn above the
  // reader in the one region where no anchor holds them.
  const historyStartSlot = useMemo(() => {
    if (!hasOlderHistory && !isLoadingOlderHistory) {
      return null;
    }
    return (
      <div
        style={historyStartSlotStyle}
        data-testid={isLoadingOlderHistory ? "load-older-history-spinner" : undefined}
      >
        {isLoadingOlderHistory ? <ActivityIndicator size="small" /> : null}
      </div>
    );
  }, [hasOlderHistory, isLoadingOlderHistory]);
  const shouldRenderEmpty =
    !boundary.hasMountedHistory &&
    !boundary.hasVirtualizedHistory &&
    !boundary.hasLiveHead &&
    !liveAuxiliary;

  return (
    <>
      <div
        ref={handleScrollContainerRef}
        data-testid="agent-chat-scroll"
        id={`agent-chat-scroll-${shouldUseVirtualizer ? "web-dom-virtualized" : "web-dom-scroll"}`}
        style={scrollContainerStyle}
      >
        <div ref={handleContentRef} style={contentContainerStyle}>
          {historyStartSlot}
          {shouldUseVirtualizer ? (
            <div
              ref={handleVirtualizedBlockRef}
              style={virtualRowsContainerStyle}
              {...{ [VIRTUALIZED_BLOCK_ATTRIBUTE]: "" }}
            >
              {virtualRows.map((virtualRow) => {
                const item = segments.historyVirtualized[virtualRow.index];
                if (!item) {
                  return null;
                }
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={measureVirtualizedRowElement}
                    style={renderVirtualRowStyle(virtualRow.start)}
                  >
                    {renderHistoryVirtualizedRow(
                      item,
                      virtualRow.index,
                      segments.historyVirtualized,
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
          {mountedHistoryRows}
          {liveHeadRows}
          {liveAuxiliary}
          {shouldRenderEmpty ? listEmptyComponent : null}
        </div>
      </div>
      {scrollbarOverlay}
    </>
  );
}

export function createWebStreamStrategy(input: CreateWebStreamStrategyInput): StreamStrategy {
  return createStreamStrategy({
    render: (renderInput) => (
      <WebStreamViewport
        key={renderInput.agentId}
        {...renderInput}
        isMobileBreakpoint={input.isMobileBreakpoint}
      />
    ),
    orderTailReverse: false,
    orderHeadReverse: false,
    assistantTurnTraversalStep: -1,
    edgeSlot: "footer",
    historyLiveBoundaryEdge: "last",
    liveHeadHistoryBoundaryEdge: "first",
    frameChildOrder: "content-then-footer",
    flatListInverted: false,
    overlayScrollbarInverted: false,
    maintainVisibleContentPosition: undefined,
    bottomAnchorTransportBehavior: {
      verificationDelayFrames: 0,
      verificationRetryMode: "rescroll",
    },
    disableParentScrollOnInlineDetailsExpansion: false,
    anchorBottomOnContentSizeChange: true,
    animateManualScrollToBottom: false,
    useVirtualizedList: false,
    isNearBottom: (inputMetrics) => {
      const distanceFromBottom = Math.max(
        0,
        inputMetrics.contentHeight - (inputMetrics.offsetY + inputMetrics.viewportHeight),
      );
      return distanceFromBottom <= inputMetrics.threshold;
    },
    getBottomOffset: (metrics) => Math.max(0, metrics.contentHeight - metrics.viewportHeight),
  });
}
