import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PanResponder,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
  View,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { isWeb as platformIsWeb } from "@/constants/platform";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import {
  computeScrollOffsetFromDragDelta,
  computeVerticalScrollbarGeometry,
} from "./web-desktop-scrollbar.math";

const METRICS_EPSILON = 0.5;
const HANDLE_WIDTH_IDLE = 6;
const HANDLE_WIDTH_ACTIVE = 9;
const HANDLE_GRAB_WIDTH = 18;
const HANDLE_GRAB_VERTICAL_PADDING = 8;
const HANDLE_OPACITY_VISIBLE = 0.62;
const HANDLE_OPACITY_HOVERED = 0.78;
const HANDLE_OPACITY_DRAGGING = 0.9;
const HANDLE_TRAVEL_TRANSITION_DURATION_MS = 90;
const HANDLE_FADE_DURATION_MS = 220;
const HANDLE_WIDTH_TRANSITION_DURATION_MS = 240;
const HANDLE_SCROLL_VISIBILITY_MS = 1200;
const HANDLE_SCROLL_ACTIVE_MS = 110;

export type ScrollbarAxis = "vertical" | "horizontal";

interface WebPointerStyle {
  cursor?: "grab" | "grabbing";
  touchAction?: "none";
  userSelect?: "none";
  transitionProperty?: string;
  transitionDuration?: string;
  transitionTimingFunction?: string;
}

interface PointerLikeEvent {
  clientX?: number;
  clientY?: number;
  pageX?: number;
  pageY?: number;
  nativeEvent?: {
    clientX?: number;
    clientY?: number;
    pageX?: number;
    pageY?: number;
    preventDefault?: () => void;
  };
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

function readClientCoordinate(event: PointerLikeEvent, axis: ScrollbarAxis): number | null {
  const native = event?.nativeEvent;
  const value =
    axis === "horizontal"
      ? (native?.clientX ?? event?.clientX ?? native?.pageX ?? event?.pageX)
      : (native?.clientY ?? event?.clientY ?? native?.pageY ?? event?.pageY);
  return typeof value === "number" ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function thumbRegionAxisStyle(isHorizontal: boolean, size: number, offset: number): ViewStyle {
  return isHorizontal
    ? { width: size, transform: [{ translateX: offset }] }
    : { height: size, transform: [{ translateY: offset }] };
}

function computeHandleOpacity(
  isDragging: boolean,
  isHandleHovered: boolean,
  isScrollVisible: boolean,
): number {
  if (isDragging) return HANDLE_OPACITY_DRAGGING;
  if (isHandleHovered) return HANDLE_OPACITY_HOVERED;
  if (isScrollVisible) return HANDLE_OPACITY_VISIBLE;
  return 0;
}

function handleAxisStyle(
  isHorizontal: boolean,
  inset: number,
  length: number,
  thickness: number,
): ViewStyle {
  return isHorizontal
    ? { marginLeft: inset, width: length, height: thickness }
    : { marginTop: inset, height: length, width: thickness };
}

export interface ScrollbarMetrics {
  offset: number;
  viewportSize: number;
  contentSize: number;
}

function areMetricsEqual(a: ScrollbarMetrics, b: ScrollbarMetrics): boolean {
  return (
    Math.abs(a.offset - b.offset) <= METRICS_EPSILON &&
    Math.abs(a.viewportSize - b.viewportSize) <= METRICS_EPSILON &&
    Math.abs(a.contentSize - b.contentSize) <= METRICS_EPSILON
  );
}

interface WebDesktopScrollbarOverlayProps {
  enabled: boolean;
  metrics: ScrollbarMetrics;
  onScrollToOffset: (offset: number) => void;
  inverted?: boolean;
  axis?: ScrollbarAxis;
}

export function useWebDesktopScrollbarMetrics(axis: ScrollbarAxis = "vertical") {
  const [metrics, setMetrics] = useState<ScrollbarMetrics>({
    offset: 0,
    viewportSize: 0,
    contentSize: 0,
  });

  const setMetricsIfChanged = useCallback((next: ScrollbarMetrics) => {
    setMetrics((previous) => (areMetricsEqual(previous, next) ? previous : next));
  }, []);

  const isHorizontal = axis === "horizontal";

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
      setMetricsIfChanged({
        offset: Math.max(0, isHorizontal ? contentOffset.x : contentOffset.y),
        viewportSize: Math.max(
          0,
          isHorizontal ? layoutMeasurement.width : layoutMeasurement.height,
        ),
        contentSize: Math.max(0, isHorizontal ? contentSize.width : contentSize.height),
      });
    },
    [isHorizontal, setMetricsIfChanged],
  );

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { layout } = event.nativeEvent;
      const viewportSize = Math.max(0, isHorizontal ? layout.width : layout.height);
      setMetrics((previous) => {
        const next = { ...previous, viewportSize };
        return areMetricsEqual(previous, next) ? previous : next;
      });
    },
    [isHorizontal],
  );

  const onContentSizeChange = useCallback(
    (width: number, height: number) => {
      const contentSize = Math.max(0, isHorizontal ? width : height);
      setMetrics((previous) => {
        const next = { ...previous, contentSize };
        return areMetricsEqual(previous, next) ? previous : next;
      });
    },
    [isHorizontal],
  );

  const setOffset = useCallback((offset: number) => {
    const clampedOffset = Math.max(0, offset);
    setMetrics((previous) => {
      const next = { ...previous, offset: clampedOffset };
      return areMetricsEqual(previous, next) ? previous : next;
    });
  }, []);

  return {
    ...metrics,
    onScroll,
    onLayout,
    onContentSizeChange,
    setOffset,
  };
}

export function WebDesktopScrollbarOverlay({
  enabled,
  metrics,
  onScrollToOffset,
  inverted = false,
  axis = "vertical",
}: WebDesktopScrollbarOverlayProps) {
  const { theme } = useUnistyles();
  const isHorizontal = axis === "horizontal";
  const [isHandleHovered, setIsHandleHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isScrollVisible, setIsScrollVisible] = useState(false);
  const [isScrollActive, setIsScrollActive] = useState(false);
  const dragStartOffsetRef = useRef(0);
  const dragStartClientCoordinateRef = useRef(0);
  const scrollVisibilityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollActiveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastObservedOffsetRef = useRef<number | null>(null);
  const geometryRef = useRef({
    maxHandleOffset: 0,
    maxScrollOffset: 0,
  });
  const onScrollToOffsetRef = useRef(onScrollToOffset);

  const maxScrollOffset = Math.max(0, metrics.contentSize - metrics.viewportSize);
  const normalizedOffset = inverted
    ? Math.max(0, maxScrollOffset - clamp(metrics.offset, 0, maxScrollOffset))
    : clamp(metrics.offset, 0, maxScrollOffset);
  const normalizedOffsetRef = useRef(normalizedOffset);

  const geometry = useMemo(
    () =>
      computeVerticalScrollbarGeometry({
        viewportSize: metrics.viewportSize,
        contentSize: metrics.contentSize,
        offset: normalizedOffset,
      }),
    [metrics.contentSize, metrics.viewportSize, normalizedOffset],
  );

  useEffect(() => {
    geometryRef.current = {
      maxHandleOffset: geometry.maxHandleOffset,
      maxScrollOffset: geometry.maxScrollOffset,
    };
  }, [geometry.maxHandleOffset, geometry.maxScrollOffset]);

  useEffect(() => {
    onScrollToOffsetRef.current = onScrollToOffset;
  }, [onScrollToOffset]);

  useEffect(() => {
    normalizedOffsetRef.current = normalizedOffset;
  }, [normalizedOffset]);

  const clearScrollVisibilityTimeout = useCallback(() => {
    if (scrollVisibilityTimeoutRef.current === null) {
      return;
    }
    clearTimeout(scrollVisibilityTimeoutRef.current);
    scrollVisibilityTimeoutRef.current = null;
  }, []);

  const clearScrollActiveTimeout = useCallback(() => {
    if (scrollActiveTimeoutRef.current === null) {
      return;
    }
    clearTimeout(scrollActiveTimeoutRef.current);
    scrollActiveTimeoutRef.current = null;
  }, []);

  const revealScrollbarFromScroll = useCallback(() => {
    setIsScrollVisible(true);
    clearScrollVisibilityTimeout();
    scrollVisibilityTimeoutRef.current = setTimeout(() => {
      setIsScrollVisible(false);
      scrollVisibilityTimeoutRef.current = null;
    }, HANDLE_SCROLL_VISIBILITY_MS);
  }, [clearScrollVisibilityTimeout]);

  const markScrollActivity = useCallback(() => {
    setIsScrollActive(true);
    clearScrollActiveTimeout();
    scrollActiveTimeoutRef.current = setTimeout(() => {
      setIsScrollActive(false);
      scrollActiveTimeoutRef.current = null;
    }, HANDLE_SCROLL_ACTIVE_MS);
  }, [clearScrollActiveTimeout]);

  useEffect(() => {
    if (!enabled || !geometry.isVisible) {
      setIsScrollVisible(false);
      setIsScrollActive(false);
      clearScrollVisibilityTimeout();
      clearScrollActiveTimeout();
      lastObservedOffsetRef.current = null;
      return;
    }

    const previousOffset = lastObservedOffsetRef.current;
    lastObservedOffsetRef.current = normalizedOffset;
    if (previousOffset === null) {
      return;
    }
    if (Math.abs(normalizedOffset - previousOffset) <= METRICS_EPSILON) {
      return;
    }
    revealScrollbarFromScroll();
    markScrollActivity();
  }, [
    clearScrollActiveTimeout,
    clearScrollVisibilityTimeout,
    enabled,
    geometry.isVisible,
    markScrollActivity,
    normalizedOffset,
    revealScrollbarFromScroll,
  ]);

  useEffect(
    () => () => {
      clearScrollActiveTimeout();
      clearScrollVisibilityTimeout();
    },
    [clearScrollActiveTimeout, clearScrollVisibilityTimeout],
  );

  const applyDragDelta = useCallback(
    (dragDelta: number) => {
      const currentGeometry = geometryRef.current;
      const nextNormalizedOffset = computeScrollOffsetFromDragDelta({
        startOffset: dragStartOffsetRef.current,
        dragDelta,
        maxScrollOffset: currentGeometry.maxScrollOffset,
        maxHandleOffset: currentGeometry.maxHandleOffset,
      });
      const nextOffset = inverted
        ? currentGeometry.maxScrollOffset - nextNormalizedOffset
        : nextNormalizedOffset;
      onScrollToOffsetRef.current(nextOffset);
    },
    [inverted],
  );

  const panResponder = useMemo(() => {
    if (platformIsWeb) {
      return null;
    }

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event: GestureResponderEvent) => {
        const clientCoordinate = readClientCoordinate(event, axis);
        dragStartOffsetRef.current = normalizedOffsetRef.current;
        if (clientCoordinate !== null) {
          dragStartClientCoordinateRef.current = clientCoordinate;
        }
        setIsDragging(true);
      },
      onPanResponderMove: (_event, gestureState) => {
        applyDragDelta(isHorizontal ? gestureState.dx : gestureState.dy);
      },
      onPanResponderRelease: () => {
        setIsDragging(false);
      },
      onPanResponderTerminate: () => {
        setIsDragging(false);
      },
    });
  }, [applyDragDelta, axis, isHorizontal]);

  const startWebDrag = useCallback(
    (event: PointerLikeEvent) => {
      if (!platformIsWeb) {
        return;
      }
      const clientCoordinate = readClientCoordinate(event, axis);
      if (clientCoordinate === null) {
        return;
      }
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.nativeEvent?.preventDefault?.();
      dragStartOffsetRef.current = normalizedOffsetRef.current;
      dragStartClientCoordinateRef.current = clientCoordinate;
      setIsDragging(true);
    },
    [axis],
  );

  const handleGrabHoverIn = useCallback(() => {
    if (!isScrollVisible && !isDragging) {
      return;
    }
    setIsHandleHovered(true);
  }, [isDragging, isScrollVisible]);

  const handleGrabHoverOut = useCallback(() => {
    setIsHandleHovered(false);
  }, []);

  useEffect(() => {
    if (!platformIsWeb || !isDragging) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const clientCoordinate = isHorizontal ? event.clientX : event.clientY;
      applyDragDelta(clientCoordinate - dragStartClientCoordinateRef.current);
    };

    const stopDragging = () => {
      setIsDragging(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [applyDragDelta, isDragging, isHorizontal]);

  const handleVisible = isDragging || isScrollVisible || isHandleHovered;
  const handleOpacity = computeHandleOpacity(isDragging, isHandleHovered, isScrollVisible);
  const handleThickness = isDragging || isHandleHovered ? HANDLE_WIDTH_ACTIVE : HANDLE_WIDTH_IDLE;
  const handleColor = theme.colors.scrollbarHandle;
  const handleCursor = isDragging ? "grabbing" : "grab";
  const handleTravelDurationMs =
    isDragging || isScrollActive ? 0 : HANDLE_TRAVEL_TRANSITION_DURATION_MS;
  const thumbRegionOffset = Math.max(0, geometry.handleOffset - HANDLE_GRAB_VERTICAL_PADDING);
  const thumbRegionSize = Math.min(
    metrics.viewportSize - thumbRegionOffset,
    geometry.handleSize + HANDLE_GRAB_VERTICAL_PADDING * 2,
  );
  const handleInset = Math.max(0, (thumbRegionSize - geometry.handleSize) / 2);

  const thumbRegionStyle = useMemo(
    () => [
      isHorizontal ? styles.thumbRegionHorizontal : styles.thumbRegionVertical,
      inlineUnistylesStyle(thumbRegionAxisStyle(isHorizontal, thumbRegionSize, thumbRegionOffset)),
      platformIsWeb &&
        inlineUnistylesStyle({
          cursor: handleCursor,
          touchAction: "none",
          userSelect: "none",
          transitionProperty: "transform",
          transitionDuration: `${handleTravelDurationMs}ms`,
          transitionTimingFunction: "linear",
        } satisfies WebPointerStyle as unknown as ViewStyle),
    ],
    [isHorizontal, thumbRegionSize, thumbRegionOffset, handleCursor, handleTravelDurationMs],
  );

  const handleStyle = useMemo(
    () => [
      styles.handle,
      inlineUnistylesStyle({
        ...handleAxisStyle(isHorizontal, handleInset, geometry.handleSize, handleThickness),
        backgroundColor: handleColor,
        opacity: handleOpacity,
      }),
      platformIsWeb &&
        inlineUnistylesStyle({
          transitionProperty: `opacity, ${isHorizontal ? "height" : "width"}, background-color`,
          transitionDuration: `${HANDLE_FADE_DURATION_MS}ms, ${HANDLE_WIDTH_TRANSITION_DURATION_MS}ms, ${HANDLE_FADE_DURATION_MS}ms`,
          transitionTimingFunction: "ease-out, cubic-bezier(0.22, 0.75, 0.2, 1), ease-out",
        } satisfies WebPointerStyle as unknown as ViewStyle),
    ],
    [isHorizontal, handleInset, geometry.handleSize, handleThickness, handleColor, handleOpacity],
  );

  if (!enabled || !geometry.isVisible) {
    return null;
  }

  return (
    <View
      style={isHorizontal ? styles.overlayHorizontal : styles.overlayVertical}
      pointerEvents="box-none"
    >
      <View
        style={thumbRegionStyle}
        pointerEvents={handleVisible ? "auto" : "none"}
        {...(panResponder?.panHandlers ?? {})}
        {...(platformIsWeb
          ? ({
              onPointerDown: startWebDrag,
              onMouseEnter: handleGrabHoverIn,
              onMouseLeave: handleGrabHoverOut,
            } as object)
          : null)}
      >
        <View style={handleStyle} pointerEvents="none" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  overlayVertical: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: 12,
    alignItems: "center",
    justifyContent: "flex-start",
    zIndex: 10,
  },
  overlayHorizontal: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 12,
    justifyContent: "center",
    alignItems: "flex-start",
    zIndex: 10,
  },
  handle: {
    borderRadius: 999,
    alignSelf: "center",
  },
  thumbRegionVertical: {
    position: "absolute",
    right: -3,
    width: HANDLE_GRAB_WIDTH,
    top: 0,
  },
  thumbRegionHorizontal: {
    position: "absolute",
    bottom: -3,
    height: HANDLE_GRAB_WIDTH,
    left: 0,
    flexDirection: "row",
  },
}));
