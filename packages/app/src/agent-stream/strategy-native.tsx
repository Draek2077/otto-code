import {
  createContext,
  Fragment,
  memo,
  type ReactElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  FlatList,
  ActivityIndicator,
  Keyboard,
  View,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import type { StreamItem } from "@/types/stream";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useBottomAnchorController } from "./bottom-anchor-controller";
import type { StreamRenderInput, StreamStrategy, StreamViewportHandle } from "./strategy";
import {
  createStreamStrategy,
  isNearBottomForStreamRenderStrategy,
  resolveBottomAnchorTransportBehavior,
} from "./strategy";
import { deriveVisibilityScrollRestoration } from "./visibility-scroll-restoration";

const DEFAULT_MAINTAIN_VISIBLE_CONTENT_POSITION = Object.freeze({
  minIndexForVisible: 0,
  autoscrollToTopThreshold: 0,
});
const HISTORY_START_THRESHOLD_PX = 96;
const NATIVE_BOTTOM_INDICATOR_THRESHOLD_PX = 8;
// A reader should have to move about a dozen transcript lines before taking
// ownership from follow mode. Short flicks are treated as an accidental gap
// and return to the newest edge when the native scroll sequence finishes.
const NATIVE_BOTTOM_SNAP_THRESHOLD_PX = 288;

function keyExtractor(item: { id: string }): string {
  return item.id;
}

/**
 * The live turn renders in the inverted list's header, so before this store it
 * was a fresh element on every ~48ms stream flush - which changed a FlatList
 * prop, re-rendered VirtualizedList, and walked every mounted cell in the
 * window. On a phone that is the whole per-chunk cost of a long chat, and it is
 * what makes typing stutter while the model streams (one JS thread, shared).
 *
 * Now the header node is published through an external store and read by a
 * component whose identity never changes, so a flush re-renders ONLY the live
 * turn. Everything the FlatList itself is handed stays referentially stable and
 * React bails out of the list subtree entirely (see the memoized element below).
 */
interface LiveHeaderStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ReactElement | null;
}

const EMPTY_LIVE_HEADER_STORE: LiveHeaderStore = {
  subscribe: () => () => {},
  getSnapshot: () => null,
};

const LiveHeaderContext = createContext<LiveHeaderStore>(EMPTY_LIVE_HEADER_STORE);

// One cached copy per (item, breakpoint), so flipping the breakpoint hands the
// FlatList fresh identities exactly once instead of on every later render.
const historyRowDisplayVariants = new WeakMap<
  StreamItem,
  { compact?: StreamItem; regular?: StreamItem }
>();

function getHistoryRowDisplayVariant(item: StreamItem, compact: boolean): StreamItem {
  let variants = historyRowDisplayVariants.get(item);
  if (!variants) {
    variants = {};
    historyRowDisplayVariants.set(item, variants);
  }
  const key = compact ? "compact" : "regular";
  variants[key] ??= { ...item };
  return variants[key];
}

function useLiveHeaderStore(content: ReactElement | null): LiveHeaderStore {
  const contentRef = useRef<ReactElement | null>(content);
  const listenersRef = useRef(new Set<() => void>());

  // Layout effect, not render: publishing during render would tear if React
  // threw the render away. Committing before paint keeps the reveal frame-exact.
  useLayoutEffect(() => {
    if (contentRef.current === content) {
      return;
    }
    contentRef.current = content;
    for (const listener of listenersRef.current) {
      listener();
    }
  }, [content]);

  return useMemo(
    () => ({
      subscribe: (listener: () => void) => {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
      getSnapshot: () => contentRef.current,
    }),
    [],
  );
}

const LiveStreamHeader = memo(function LiveStreamHeader() {
  const store = useContext(LiveHeaderContext);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
});

function NativeStreamViewport(props: StreamRenderInput & { strategy: StreamStrategy }) {
  const {
    agentId,
    segments,
    historyRowRevision,
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
    listStyle,
    baseListContentContainerStyle,
    strategy,
  } = props;
  const { renderHistoryMountedRow, renderLiveHeadRow, renderLiveAuxiliary } = renderers;
  const flatListRef = useRef<FlatList<StreamItem>>(null);
  const isPaneVisible = useRetainedPanelActive();
  const isPaneVisibleRef = useRef(isPaneVisible);
  const wasPaneVisibleRef = useRef(isPaneVisible);
  const lastVisibleScrollOffsetYRef = useRef(0);
  const streamViewportMetricsRef = useRef({
    containerKey: "native-virtualized",
    contentHeight: 0,
    viewportWidth: 0,
    viewportHeight: 0,
    offsetY: 0,
    viewportMeasuredForKey: null as string | null,
    contentMeasuredForKey: null as string | null,
  });
  const scrollOffsetYRef = useRef(0);
  const programmaticScrollEventBudgetRef = useRef(0);
  const isAnimatedProgrammaticScrollActiveRef = useRef(false);
  const isNativeUserScrollActiveRef = useRef(false);
  const isNativeMomentumScrollActiveRef = useRef(false);
  const pendingNativeUserScrollEndFrameRef = useRef<number | null>(null);
  const [isNativeViewportSettling, setIsNativeViewportSettling] = useState(false);
  const nativeViewportSettlingFrameIdRef = useRef<number | null>(null);
  const historyStartReadyRef = useRef(false);

  isPaneVisibleRef.current = isPaneVisible;

  const historyItems = useMemo(() => {
    if (segments.historyVirtualized.length === 0) {
      return segments.historyMounted;
    }
    return [...segments.historyVirtualized, ...segments.historyMounted];
  }, [segments.historyMounted, segments.historyVirtualized]);
  // Keep unchanged item identities intact so live updates only rerender the rows
  // whose projected content or local display state actually changed. Without
  // this a collapsed tool-call run sitting in retained history would keep its
  // stale counts (and its spinner) after the run finished. A breakpoint change
  // is rare and intentionally refreshes the whole history window.
  const globallyRevisedHistoryRows = useMemo(() => {
    const globalDisplayState = historyRowRevision?.globalDisplayState ?? false;
    return historyItems.map((item) => getHistoryRowDisplayVariant(item, globalDisplayState));
  }, [historyItems, historyRowRevision?.globalDisplayState]);
  const displayStateHistoryRows = useMemo(
    () =>
      globallyRevisedHistoryRows.map((item) =>
        historyRowRevision?.displayStateById.has(item.id) ? { ...item } : item,
      ),
    [globallyRevisedHistoryRows, historyRowRevision?.displayStateById],
  );
  const historyRows = useMemo(
    () =>
      displayStateHistoryRows.map((item) =>
        historyRowRevision?.contentById.has(item.id) ? { ...item } : item,
      ),
    [displayStateHistoryRows, historyRowRevision?.contentById],
  );

  const clearNativeViewportSettling = useCallback(() => {
    if (nativeViewportSettlingFrameIdRef.current !== null) {
      cancelAnimationFrame(nativeViewportSettlingFrameIdRef.current);
      nativeViewportSettlingFrameIdRef.current = null;
    }
  }, []);

  const markNativeViewportSettling = useCallback(() => {
    clearNativeViewportSettling();
    setIsNativeViewportSettling(true);
    let remainingFrames = 4;
    const tick = () => {
      if (remainingFrames <= 0) {
        nativeViewportSettlingFrameIdRef.current = null;
        setIsNativeViewportSettling(false);
        return;
      }
      remainingFrames -= 1;
      nativeViewportSettlingFrameIdRef.current = requestAnimationFrame(tick);
    };
    nativeViewportSettlingFrameIdRef.current = requestAnimationFrame(tick);
  }, [clearNativeViewportSettling]);

  const bottomAnchorTransportBehavior = useMemo(
    () =>
      resolveBottomAnchorTransportBehavior({
        strategy,
        isViewportSettling: isNativeViewportSettling,
      }),
    [isNativeViewportSettling, strategy],
  );

  const scrollToBottom = useCallback(
    (animated: boolean) => {
      if (!isPaneVisibleRef.current) {
        return;
      }
      if (!animated && isAnimatedProgrammaticScrollActiveRef.current) {
        return;
      }
      // At offset zero an inverted list already represents the newest edge.
      // Reissuing this command for every stream flush interrupts native touch
      // and momentum handling. Following mode disables native visible-content
      // preservation below, so no later layout correction can move this edge.
      if (!animated && scrollOffsetYRef.current <= 1) {
        onNearBottomChange(true);
        return;
      }
      isAnimatedProgrammaticScrollActiveRef.current = animated;
      programmaticScrollEventBudgetRef.current = 3;
      flatListRef.current?.scrollToOffset({
        offset: 0,
        animated,
      });
      scrollOffsetYRef.current = 0;
      lastVisibleScrollOffsetYRef.current = 0;
      streamViewportMetricsRef.current = {
        ...streamViewportMetricsRef.current,
        offsetY: 0,
      };
      onNearBottomChange(true);
    },
    [onNearBottomChange],
  );

  const bottomAnchorController = useBottomAnchorController({
    agentId,
    routeRequest: routeBottomAnchorRequest,
    isAuthoritativeHistoryReady,
    renderStrategy: "inverted-stream",
    transportBehavior: bottomAnchorTransportBehavior,
    getMeasurementState: () => streamViewportMetricsRef.current,
    isNearBottom: () => {
      const metrics = streamViewportMetricsRef.current;
      return isNearBottomForStreamRenderStrategy({
        strategy,
        offsetY: metrics.offsetY,
        threshold: NATIVE_BOTTOM_SNAP_THRESHOLD_PX,
        contentHeight: metrics.contentHeight,
        viewportHeight: metrics.viewportHeight,
      });
    },
    scrollToBottom,
  });
  const bottomAnchorControllerRef = useRef(bottomAnchorController);
  bottomAnchorControllerRef.current = bottomAnchorController;

  const finishNativeUserScroll = useStableEvent(() => {
    if (!isNativeUserScrollActiveRef.current) {
      return;
    }
    if (pendingNativeUserScrollEndFrameRef.current !== null) {
      cancelAnimationFrame(pendingNativeUserScrollEndFrameRef.current);
      pendingNativeUserScrollEndFrameRef.current = null;
    }
    isNativeUserScrollActiveRef.current = false;
    isNativeMomentumScrollActiveRef.current = false;
    const metrics = streamViewportMetricsRef.current;
    const isNearBottom = isNearBottomForStreamRenderStrategy({
      strategy,
      offsetY: metrics.offsetY,
      threshold: NATIVE_BOTTOM_SNAP_THRESHOLD_PX,
      contentHeight: metrics.contentHeight,
      viewportHeight: metrics.viewportHeight,
    });
    bottomAnchorControllerRef.current.endUserScroll({ isNearBottom });
    if (isNearBottom && metrics.offsetY > NATIVE_BOTTOM_INDICATOR_THRESHOLD_PX) {
      scrollToBottom(false);
    }
  });

  const handleScrollBeginDrag = useStableEvent(() => {
    if (pendingNativeUserScrollEndFrameRef.current !== null) {
      cancelAnimationFrame(pendingNativeUserScrollEndFrameRef.current);
      pendingNativeUserScrollEndFrameRef.current = null;
    }
    isNativeUserScrollActiveRef.current = true;
    isNativeMomentumScrollActiveRef.current = false;
    isAnimatedProgrammaticScrollActiveRef.current = false;
    programmaticScrollEventBudgetRef.current = 0;
    bottomAnchorControllerRef.current.beginUserScroll();
  });

  const handleScrollEndDrag = useStableEvent(() => {
    if (!isNativeUserScrollActiveRef.current) {
      return;
    }
    pendingNativeUserScrollEndFrameRef.current = requestAnimationFrame(() => {
      pendingNativeUserScrollEndFrameRef.current = null;
      if (!isNativeMomentumScrollActiveRef.current) {
        finishNativeUserScroll();
      }
    });
  });

  const handleMomentumScrollBegin = useStableEvent(() => {
    if (!isNativeUserScrollActiveRef.current) {
      return;
    }
    isNativeMomentumScrollActiveRef.current = true;
    if (pendingNativeUserScrollEndFrameRef.current !== null) {
      cancelAnimationFrame(pendingNativeUserScrollEndFrameRef.current);
      pendingNativeUserScrollEndFrameRef.current = null;
    }
  });

  const handleMomentumScrollEnd = useStableEvent(() => {
    if (isAnimatedProgrammaticScrollActiveRef.current) {
      isAnimatedProgrammaticScrollActiveRef.current = false;
      bottomAnchorControllerRef.current.reevaluate(false);
      return;
    }
    if (isNativeUserScrollActiveRef.current) {
      finishNativeUserScroll();
    }
  });

  useLayoutEffect(() => {
    const wasPaneVisible = wasPaneVisibleRef.current;
    wasPaneVisibleRef.current = isPaneVisible;
    const restoration = deriveVisibilityScrollRestoration({
      wasVisible: wasPaneVisible,
      isVisible: isPaneVisible,
      followsOutput: bottomAnchorControllerRef.current.mode === "sticky-bottom",
    });
    if (restoration === "none") {
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (restoration === "stick-to-bottom") {
        bottomAnchorControllerRef.current.requestLocalAnchor({ agentId, reason: "jump-to-bottom" });
        return;
      }
      programmaticScrollEventBudgetRef.current = 3;
      flatListRef.current?.scrollToOffset({
        offset: lastVisibleScrollOffsetYRef.current,
        animated: false,
      });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [agentId, isPaneVisible]);

  useEffect(() => {
    streamViewportMetricsRef.current = {
      containerKey: "native-virtualized",
      contentHeight: 0,
      viewportWidth: 0,
      viewportHeight: 0,
      offsetY: 0,
      viewportMeasuredForKey: null,
      contentMeasuredForKey: null,
    };
    scrollOffsetYRef.current = 0;
    isAnimatedProgrammaticScrollActiveRef.current = false;
    isNativeUserScrollActiveRef.current = false;
    isNativeMomentumScrollActiveRef.current = false;
    if (pendingNativeUserScrollEndFrameRef.current !== null) {
      cancelAnimationFrame(pendingNativeUserScrollEndFrameRef.current);
      pendingNativeUserScrollEndFrameRef.current = null;
    }
    clearNativeViewportSettling();
    setIsNativeViewportSettling(false);
    historyStartReadyRef.current = false;
    const frame = requestAnimationFrame(() => {
      historyStartReadyRef.current = true;
    });
    return () => {
      cancelAnimationFrame(frame);
      if (pendingNativeUserScrollEndFrameRef.current !== null) {
        cancelAnimationFrame(pendingNativeUserScrollEndFrameRef.current);
        pendingNativeUserScrollEndFrameRef.current = null;
      }
    };
  }, [agentId, clearNativeViewportSettling]);

  useEffect(() => {
    const keyboardEvents = [
      "keyboardWillShow",
      "keyboardWillHide",
      "keyboardDidShow",
      "keyboardDidHide",
      "keyboardWillChangeFrame",
      "keyboardDidChangeFrame",
    ] as const;
    const subscriptions = keyboardEvents.map((eventName) =>
      Keyboard.addListener(eventName, () => {
        markNativeViewportSettling();
      }),
    );
    return () => {
      for (const subscription of subscriptions) {
        subscription.remove();
      }
      clearNativeViewportSettling();
    };
  }, [clearNativeViewportSettling, markNativeViewportSettling]);

  useEffect(() => {
    bottomAnchorController.prepareForStickyContentChange();
  }, [bottomAnchorController, historyRows, segments.liveHead]);

  useEffect(() => {
    const handle: StreamViewportHandle = {
      scrollToBottom: (reason = "jump-to-bottom") => {
        bottomAnchorController.requestLocalAnchor({
          agentId,
          reason,
        });
      },
      prepareForViewportChange: () => {
        bottomAnchorController.prepareForStickyViewportChange();
        markNativeViewportSettling();
      },
    };
    viewportRef.current = handle;
    return () => {
      if (viewportRef.current === handle) {
        viewportRef.current = null;
      }
    };
  }, [agentId, bottomAnchorController, markNativeViewportSettling, viewportRef]);

  const handleScroll = useStableEvent((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!isPaneVisibleRef.current) {
      return;
    }
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const previousOffsetY = scrollOffsetYRef.current;
    scrollOffsetYRef.current = contentOffset.y;
    lastVisibleScrollOffsetYRef.current = contentOffset.y;
    streamViewportMetricsRef.current = {
      contentHeight: Math.max(0, contentSize.height),
      viewportWidth: Math.max(0, layoutMeasurement.width),
      viewportHeight: Math.max(0, layoutMeasurement.height),
      containerKey: "native-virtualized",
      offsetY: contentOffset.y,
      viewportMeasuredForKey: "native-virtualized",
      contentMeasuredForKey: "native-virtualized",
    };

    const withinBottomSnapZone = isNearBottomForStreamRenderStrategy({
      strategy,
      offsetY: contentOffset.y,
      threshold: NATIVE_BOTTOM_SNAP_THRESHOLD_PX,
      contentHeight: streamViewportMetricsRef.current.contentHeight,
      viewportHeight: streamViewportMetricsRef.current.viewportHeight,
    });
    const atBottomForIndicator = isNearBottomForStreamRenderStrategy({
      strategy,
      offsetY: contentOffset.y,
      threshold: NATIVE_BOTTOM_INDICATOR_THRESHOLD_PX,
      contentHeight: streamViewportMetricsRef.current.contentHeight,
      viewportHeight: streamViewportMetricsRef.current.viewportHeight,
    });
    const isAnimatedProgrammaticScroll = isAnimatedProgrammaticScrollActiveRef.current;
    if (isAnimatedProgrammaticScroll && atBottomForIndicator) {
      isAnimatedProgrammaticScrollActiveRef.current = false;
    }
    onNearBottomChange(atBottomForIndicator);

    const distanceFromOldestEdge =
      streamViewportMetricsRef.current.contentHeight -
      streamViewportMetricsRef.current.viewportHeight -
      contentOffset.y;
    if (
      historyStartReadyRef.current &&
      hasOlderHistory &&
      distanceFromOldestEdge <= HISTORY_START_THRESHOLD_PX
    ) {
      onNearHistoryStart();
    }

    if (isAnimatedProgrammaticScroll) {
      if (atBottomForIndicator) {
        programmaticScrollEventBudgetRef.current = 0;
        bottomAnchorController.handleScrollNearBottomChange({
          nextIsNearBottom: true,
          scrollDelta: 0,
        });
      }
    } else if (programmaticScrollEventBudgetRef.current > 0 && contentOffset.y <= 8) {
      programmaticScrollEventBudgetRef.current -= 1;
    } else {
      programmaticScrollEventBudgetRef.current = 0;
      bottomAnchorController.handleScrollNearBottomChange({
        nextIsNearBottom: withinBottomSnapZone,
        scrollDelta: contentOffset.y - previousOffsetY,
      });
    }

    // Keep the indicator honest until this command completes, then immediately
    // close a small gap while follow mode owns the transcript. This avoids a
    // state where Android's delayed inverted-list preservation leaves the
    // reader close to the end with a jump button they should not need.
    if (
      withinBottomSnapZone &&
      !atBottomForIndicator &&
      !isAnimatedProgrammaticScroll &&
      !isNativeUserScrollActiveRef.current &&
      bottomAnchorControllerRef.current.mode === "sticky-bottom"
    ) {
      scrollToBottom(false);
    }
  });

  const handleListLayout = useStableEvent((event: LayoutChangeEvent) => {
    if (!isPaneVisibleRef.current) {
      return;
    }
    const previousViewportWidth = streamViewportMetricsRef.current.viewportWidth;
    const previousViewportHeight = streamViewportMetricsRef.current.viewportHeight;
    const viewportWidth = Math.max(0, event.nativeEvent.layout.width);
    const viewportHeight = Math.max(0, event.nativeEvent.layout.height);
    const viewportChanged =
      (previousViewportWidth > 0 && previousViewportWidth !== viewportWidth) ||
      (previousViewportHeight > 0 && previousViewportHeight !== viewportHeight);
    streamViewportMetricsRef.current = {
      ...streamViewportMetricsRef.current,
      containerKey: "native-virtualized",
      viewportWidth,
      viewportHeight,
      viewportMeasuredForKey: "native-virtualized",
    };
    if (viewportChanged) {
      markNativeViewportSettling();
    }
    bottomAnchorController.handleViewportMetricsChange({
      previousViewportWidth,
      viewportWidth,
      previousViewportHeight,
      viewportHeight,
    });
  });

  const handleContentSizeChange = useStableEvent((_width: number, height: number) => {
    if (!isPaneVisibleRef.current) {
      return;
    }
    const nextContentHeight = Math.max(0, height);
    const previousContentHeight = streamViewportMetricsRef.current.contentHeight;
    streamViewportMetricsRef.current = {
      ...streamViewportMetricsRef.current,
      containerKey: "native-virtualized",
      contentHeight: nextContentHeight,
      contentMeasuredForKey: "native-virtualized",
    };
    bottomAnchorController.handleContentSizeChange({
      previousContentHeight,
      contentHeight: nextContentHeight,
    });
  });

  const renderItem = useStableEvent(
    ({ item, index }: ListRenderItemInfo<StreamItem>): ReactElement | null => {
      const rendered = renderHistoryMountedRow(item, index, historyRows);
      return (rendered ?? null) as ReactElement | null;
    },
  );

  const liveHeaderContent = useMemo(() => {
    const liveHeadRows = segments.liveHead.map((item, index) => (
      <Fragment key={item.id}>{renderLiveHeadRow(item, index, segments.liveHead)}</Fragment>
    ));
    const liveAuxiliary = renderLiveAuxiliary();
    if (
      liveHeadRows.length === 0 &&
      !liveAuxiliary &&
      !boundary.hasMountedHistory &&
      !boundary.hasVirtualizedHistory
    ) {
      return (listEmptyComponent ?? null) as ReactElement | null;
    }
    return (
      <Fragment>
        {liveHeadRows}
        {liveAuxiliary}
      </Fragment>
    );
  }, [boundary, listEmptyComponent, renderLiveAuxiliary, renderLiveHeadRow, segments.liveHead]);

  const historyFooterContent = useMemo(() => {
    if (!isLoadingOlderHistory) {
      return null;
    }
    return (
      <View testID="load-older-history-spinner">
        <ActivityIndicator size="small" />
      </View>
    );
  }, [isLoadingOlderHistory]);

  const liveHeaderStore = useLiveHeaderStore(liveHeaderContent);

  // History-row layout (the gap on the boundary row) depends on whether a live
  // turn is present, but NOT on its text. Keying the list on the live head's ids
  // re-renders the cells when the live turn appears, is promoted, or ends, while
  // leaving per-chunk text growth invisible to the list.
  const liveHeadSignature = useMemo(
    () => segments.liveHead.map((item) => item.id).join("\0"),
    [segments.liveHead],
  );

  // Memoized so a stream flush, which re-renders this component, hands React the
  // identical element and it skips the entire list subtree. Every dep here is
  // either referentially stable (the useStableEvent handlers, keyExtractor) or
  // genuinely requires the mounted cells to re-render.
  const list = useMemo(
    () => (
      <FlatList
        ref={flatListRef}
        data={historyRows}
        extraData={liveHeadSignature}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        testID="agent-chat-scroll"
        nativeID="agent-chat-scroll-native-virtualized"
        ListHeaderComponent={LiveStreamHeader}
        ListFooterComponent={historyFooterContent ?? undefined}
        contentContainerStyle={baseListContentContainerStyle}
        style={listStyle}
        onLayout={handleListLayout}
        onScroll={handleScroll}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={handleScrollEndDrag}
        onMomentumScrollBegin={handleMomentumScrollBegin}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        scrollEventThrottle={16}
        onContentSizeChange={handleContentSizeChange}
        // React Native applies maintainVisibleContentPosition after Android's
        // layout pass. That is correct while a detached reader owns a visible
        // row, but while following it can overwrite offset 0 after a large live
        // header mutation. At the newest edge, offset 0 is the anchor.
        maintainVisibleContentPosition={
          bottomAnchorController.mode === "detached"
            ? DEFAULT_MAINTAIN_VISIBLE_CONTENT_POSITION
            : undefined
        }
        // Sized for a phone, where every mounted cell is a markdown bubble that
        // has to re-render whenever the list does. windowSize 21 kept ten
        // viewports of chat alive above and below the screen; 7 keeps one on
        // each side, which is all an inverted transcript needs to scroll
        // smoothly. Batching the cell updates (was 0, i.e. commit each one
        // immediately) lets a burst of stream flushes coalesce into one pass.
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={50}
        windowSize={7}
        // Left off deliberately: clipping subviews on an inverted Android list
        // is a long-standing source of blank cells. Revisit only with on-device
        // proof.
        removeClippedSubviews={false}
        scrollEnabled={scrollEnabled}
        showsVerticalScrollIndicator
        inverted
      />
    ),
    [
      baseListContentContainerStyle,
      bottomAnchorController.mode,
      handleContentSizeChange,
      handleListLayout,
      handleMomentumScrollBegin,
      handleMomentumScrollEnd,
      handleScroll,
      handleScrollBeginDrag,
      handleScrollEndDrag,
      historyFooterContent,
      historyRows,
      listStyle,
      liveHeadSignature,
      renderItem,
      scrollEnabled,
    ],
  );

  return <LiveHeaderContext.Provider value={liveHeaderStore}>{list}</LiveHeaderContext.Provider>;
}

export function createNativeStreamStrategy(): StreamStrategy {
  const strategy = createStreamStrategy({
    render: (renderInput) => <NativeStreamViewport {...renderInput} strategy={strategy} />,
    orderTailReverse: true,
    orderHeadReverse: true,
    assistantTurnTraversalStep: 1,
    edgeSlot: "header",
    historyLiveBoundaryEdge: "first",
    liveHeadHistoryBoundaryEdge: "last",
    frameChildOrder: "footer-then-content",
    flatListInverted: true,
    overlayScrollbarInverted: true,
    maintainVisibleContentPosition: DEFAULT_MAINTAIN_VISIBLE_CONTENT_POSITION,
    bottomAnchorTransportBehavior: {
      verificationDelayFrames: 2,
      verificationRetryMode: "recheck",
    },
    disableParentScrollOnInlineDetailsExpansion: false,
    anchorBottomOnContentSizeChange: false,
    animateManualScrollToBottom: true,
    useVirtualizedList: true,
    isNearBottom: (input) => input.offsetY <= input.threshold,
    getBottomOffset: () => 0,
  });
  return strategy;
}
