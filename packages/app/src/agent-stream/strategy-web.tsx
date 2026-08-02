import React, {
  Fragment,
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
import { estimateStreamItemHeight } from "./web-virtualization";
import type { StreamRenderInput, StreamStrategy, StreamViewportHandle } from "./strategy";
import { createStreamStrategy } from "./strategy";

interface CreateWebStreamStrategyInput {
  isMobileBreakpoint: boolean;
}

type ScrollBehaviorLike = "auto" | "smooth";

const WEB_BOTTOM_SETTLE_TIMEOUT_MS = 200;
const USER_SCROLL_DELTA_EPSILON = 1;
const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 64;
const AUTO_SCROLL_RESUME_THRESHOLD_PX = 1;
const HISTORY_START_THRESHOLD_PX = 96;
const SCROLL_ANCHOR_DRIFT_EPSILON_PX = 0.5;
// Marks the virtualizer's block so the scroll anchor skips it: its rows are
// absolutely positioned off a running total that moves as they are measured, and
// the virtualizer compensates scrollTop for that itself. Anchoring to it would
// count the same correction twice.
const VIRTUALIZED_BLOCK_ATTRIBUTE = "data-stream-virtualized-block";
import { useWebElementScrollbar } from "@/components/use-web-scrollbar";
import { useHasFinePointer } from "@/hooks/use-fine-pointer";

const historyStartSlotStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 32,
  paddingTop: 4,
  paddingBottom: 8,
};

/**
 * A row that is currently on screen, plus where it sits relative to the top of
 * the viewport. While the reader is detached this is the fixed point the whole
 * transcript is held against: the document can grow, shrink, fold a run of tool
 * calls into a group and unfold it again, and the anchored row stays exactly
 * where their eyes are. Measured through `getBoundingClientRect` against the
 * scroll container rather than `offsetTop` so that the container moving on
 * screen (the mobile keyboard opening) cancels out instead of registering as
 * drift.
 */
interface ScrollAnchor {
  element: HTMLElement;
  viewportRelativeTop: number;
}

function measureViewportRelativeTop(scrollContainer: HTMLElement, element: HTMLElement): number {
  return element.getBoundingClientRect().top - scrollContainer.getBoundingClientRect().top;
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
    return { element: child, viewportRelativeTop: relativeTop };
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
  return getScrollContainerDistanceFromBottom(scrollContainer) < 0;
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
  const [followOutput, setFollowOutputr] = useState(true);
  const followOutputRef = useRef(followOutput);
  const setFollowOutput = (value: boolean) => {
    followOutputRef.current = value;
    setFollowOutputr(value);
    return value;
  };
  const lastKnownScrollTopRef = useRef(0);
  const lastScrollHeightRef = useRef(0);
  const lastClientHeightRef = useRef(0);
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
      return row ? estimateStreamItemHeight(row) : 120;
    },
    measureElement: measureVirtualElement,
    useAnimationFrameWithResizeObserver: true,
    overscan: 8,
  });
  useEffect(() => {
    // Detached, the reader is holding a position and every measured-vs-estimated
    // correction above them has to be absorbed. Following, the app is heading to
    // the bottom anyway and an adjustment would only fight the stick.
    rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => !followOutputRef.current;
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
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      onNearBottomChange(true);
      return;
    }
    onNearBottomChange(followOutputRef.current && isScrollContainerNearBottom(scrollContainer));
  }, [onNearBottomChange]);

  const noteProgrammaticScroll = useCallback((scrollContainer: HTMLElement) => {
    programmaticScrollTopRef.current = scrollContainer.scrollTop;
    lastKnownScrollTopRef.current = scrollContainer.scrollTop;
    lastScrollHeightRef.current = scrollContainer.scrollHeight;
    lastClientHeightRef.current = scrollContainer.clientHeight;
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
   */
  const restoreScrollAnchor = useCallback(() => {
    if (followOutputRef.current) {
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
    const drift =
      measureViewportRelativeTop(scrollContainer, anchor.element) - anchor.viewportRelativeTop;
    if (Math.abs(drift) < SCROLL_ANCHOR_DRIFT_EPSILON_PX) {
      return;
    }
    scrollContainer.scrollTop += drift;
    noteProgrammaticScroll(scrollContainer);
    // Re-read rather than assuming the correction landed whole: at the very top
    // or bottom of the range the browser clamps it, and pretending otherwise
    // would leave a standing debt that re-fires on every subsequent commit.
    anchor.viewportRelativeTop = measureViewportRelativeTop(scrollContainer, anchor.element);
  }, [captureScrollAnchor, noteProgrammaticScroll]);

  const scrollMessagesToBottom = useCallback(
    (behavior: ScrollBehaviorLike = "auto") => {
      const scrollContainer = scrollContainerRef.current;
      if (!scrollContainer || !followOutputRef.current) {
        return;
      }
      if (isScrollContainerOverscrolledPastBottom(scrollContainer)) {
        return;
      }
      scrollElementToBottom(scrollContainer, behavior);
      noteProgrammaticScroll(scrollContainer);
      updateScrollMetrics();
    },
    [noteProgrammaticScroll, updateScrollMetrics],
  );

  const scheduleStickToBottom = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer && isScrollContainerOverscrolledPastBottom(scrollContainer)) {
      return;
    }
    if (pendingAutoScrollFrameRef.current !== null) {
      return;
    }
    pendingAutoScrollFrameRef.current = window.requestAnimationFrame(() => {
      pendingAutoScrollFrameRef.current = null;
      if (!followOutputRef.current) {
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
    const isUserScroll = !isProgrammatic && !isInvoluntaryDrop;

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
    if (
      historyStartReadyRef.current &&
      hasOlderHistory &&
      currentScrollTop <= HISTORY_START_THRESHOLD_PX
    ) {
      onNearHistoryStart();
    }
  }, [
    cancelPendingStickToBottom,
    captureScrollAnchor,
    hasOlderHistory,
    onNearHistoryStart,
    updateScrollMetrics,
  ]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      historyStartReadyRef.current = true;
    });
    return () => {
      window.cancelAnimationFrame(frame);
      historyStartReadyRef.current = false;
    };
  }, [props.agentId]);

  // `onNearHistoryStart` above is reachable only from the scroll handler, and a
  // transcript shorter than its viewport never produces a scroll event. A first
  // page that does not fill the window — a tall viewport, a short page, a
  // collapsed run of turns — therefore leaves older history unrequested with no
  // scrollbar to ask for it, and the reader sees a conversation that starts in
  // the middle of itself.
  //
  // Requesting data is not a scroll write, so this sits outside the rule in
  // docs/chat-scrolling.md: the position is untouched either way, and follow /
  // detach state is not consulted or changed.
  const requestOlderHistoryWhenUnfilled = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    if (
      !scrollContainer ||
      !historyStartReadyRef.current ||
      !hasOlderHistory ||
      isLoadingOlderHistory ||
      scrollContainer.scrollHeight > scrollContainer.clientHeight
    ) {
      return;
    }
    onNearHistoryStart();
  }, [hasOlderHistory, isLoadingOlderHistory, onNearHistoryStart]);

  // Re-checked after each page lands: pages are small, so several may be needed
  // before the content outgrows a tall viewport. `hasOlderHistory` going false
  // ends it, and `isLoadingOlderHistory` keeps requests from overlapping.
  useEffect(() => {
    requestOlderHistoryWhenUnfilled();
  }, [
    requestOlderHistoryWhenUnfilled,
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
      // A window growing taller can un-fill a transcript that used to overflow,
      // which is the other way to end up with no scroll event and unrequested
      // history.
      requestOlderHistoryWhenUnfilled();
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
  }, [
    requestOlderHistoryWhenUnfilled,
    restoreScrollAnchor,
    scheduleStickToBottom,
    updateScrollMetrics,
  ]);

  // After every commit, before paint. Whatever that render did to the document
  // above the anchored row (a run of actions folding into a group, a group
  // unfolding, older history splicing in, a virtualized row swapping its
  // estimate for its measured height) is corrected out before the reader can
  // see it move. Deliberately dependency-free: the trigger is "the DOM changed",
  // not any particular prop.
  useLayoutEffect(() => {
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
  const mountedHistoryRows = useMemo(() => {
    return segments.historyMounted.map((item, index) => (
      <Fragment key={item.id}>
        {renderHistoryMountedRow(item, index, segments.historyMounted)}
      </Fragment>
    ));
  }, [renderHistoryMountedRow, segments.historyMounted]);
  const liveHeadRows = useMemo(() => {
    return segments.liveHead.map((item, index) => (
      <Fragment key={item.id}>{renderLiveHeadRow(item, index, segments.liveHead)}</Fragment>
    ));
  }, [renderLiveHeadRow, segments.liveHead]);
  const liveAuxiliary = useMemo(() => {
    return renderLiveAuxiliary();
  }, [renderLiveAuxiliary]);
  const historyStartSlot = useMemo(() => {
    if (!isLoadingOlderHistory) {
      return null;
    }
    return (
      <div style={historyStartSlotStyle} data-testid="load-older-history-spinner">
        <ActivityIndicator size="small" />
      </div>
    );
  }, [isLoadingOlderHistory]);
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
            <div style={virtualRowsContainerStyle} {...{ [VIRTUALIZED_BLOCK_ATTRIBUTE]: "" }}>
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
