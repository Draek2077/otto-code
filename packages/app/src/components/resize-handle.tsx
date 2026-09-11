import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, type PointerEvent as RNPointerEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { StyleSheet } from "react-native-unistyles";
import { PaneOverlay } from "@/components/ui/pane-overlay";
import { suspendResidentBrowserSurfaceInput } from "@/desktop/browser/resident-webviews";
import { startResizeHandleDrag, type ResizeHandleDrag } from "@/components/resize-handle-drag";
import { useHasFinePointer } from "@/hooks/use-fine-pointer";
import {
  SIDEBAR_RESIZE_ACTIVATION_OFFSET,
  SIDEBAR_RESIZE_FAIL_OFFSET,
} from "@/components/sidebar-resize-handle-layout";

export interface ResizeHandleProps {
  testID?: string;
  direction: "horizontal" | "vertical";
  hitAreaAlignment?: "center" | "end";
  groupId: string;
  index: number;
  sizes: number[];
  containerSize: number;
  onPreviewResizeSplit: (groupId: string, sizes: number[]) => void;
  onResizeSplit: (groupId: string, sizes: number[]) => void;
}

interface PointerState {
  containerSize: number;
  pointerStart: number;
  drag: ResizeHandleDrag;
}

function resetWindowHorizontalScroll() {
  // Clamp any browser scroll introduced while dragging past the viewport edge.
  if (window.scrollX === 0) {
    return;
  }
  window.scrollTo(0, window.scrollY);
}

export function ResizeHandle({
  testID,
  direction,
  hitAreaAlignment = "center",
  groupId,
  index,
  sizes,
  containerSize,
  onPreviewResizeSplit,
  onResizeSplit,
}: ResizeHandleProps) {
  const finePointer = useHasFinePointer();
  const cleanupsRef = useRef(new Set<() => void>());
  const pointerStatesRef = useRef(new Map<number, PointerState>());
  const touchDragRef = useRef<ResizeHandleDrag | null>(null);
  const releaseTouchInputRef = useRef<(() => void) | null>(null);
  const cursorBeforeDragRef = useRef<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [active, setActive] = useState(false);
  const [dragging, setDragging] = useState(false);
  const highlighted = active || dragging;

  useEffect(
    () => () => {
      for (const cleanup of cleanupsRef.current) cleanup();
      releaseTouchInputRef.current?.();
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    },
    [],
  );

  const handlePointerDown = useCallback(
    (event: RNPointerEvent) => {
      const hitAreaElement = event.currentTarget as unknown as HTMLElement | null;
      if (!hitAreaElement) {
        return;
      }

      if (containerSize <= 0) {
        return;
      }

      const pointerId = event.nativeEvent.pointerId;
      if (pointerStatesRef.current.has(pointerId)) {
        return;
      }

      setDragging(true);
      const releaseBrowserInput = suspendResidentBrowserSurfaceInput();

      pointerStatesRef.current.set(pointerId, {
        containerSize,
        pointerStart:
          direction === "horizontal" ? event.nativeEvent.clientX : event.nativeEvent.clientY,
        drag: startResizeHandleDrag({
          sizes,
          index,
          preview: (nextSizes) => onPreviewResizeSplit(groupId, nextSizes),
          commit: (nextSizes) => onResizeSplit(groupId, nextSizes),
        }),
      });

      if (pointerStatesRef.current.size === 1) {
        cursorBeforeDragRef.current = document.body.style.cursor;
      }
      const nextCursor = direction === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.cursor = nextCursor;
      event.preventDefault();
      event.stopPropagation();
      const pointerCaptureElement = hitAreaElement;
      pointerCaptureElement.setPointerCapture?.(pointerId);
      resetWindowHorizontalScroll();

      function cleanup() {
        if (!cleanupsRef.current.delete(cleanup)) return;
        releaseBrowserInput();
        pointerStatesRef.current.delete(pointerId);
        setDragging(pointerStatesRef.current.size > 0);
        if (pointerStatesRef.current.size === 0) {
          document.body.style.cursor = cursorBeforeDragRef.current ?? "";
          cursorBeforeDragRef.current = null;
        }
        if (pointerCaptureElement.hasPointerCapture?.(pointerId)) {
          pointerCaptureElement.releasePointerCapture(pointerId);
        }
        resetWindowHorizontalScroll();
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
        window.removeEventListener("blur", handleWindowBlur);
        pointerCaptureElement.removeEventListener("lostpointercapture", handlePointerUp);
      }

      function handlePointerMove(moveEvent: PointerEvent) {
        if (moveEvent.pointerId !== pointerId) {
          return;
        }

        const pointerState = pointerStatesRef.current.get(pointerId);
        if (!pointerState) {
          return;
        }

        moveEvent.preventDefault();
        resetWindowHorizontalScroll();
        const pointerCurrent = direction === "horizontal" ? moveEvent.clientX : moveEvent.clientY;
        const deltaRatio =
          (pointerCurrent - pointerState.pointerStart) / pointerState.containerSize;

        pointerState.drag.move(deltaRatio);
      }

      function handlePointerUp(upEvent: PointerEvent) {
        if (upEvent.pointerId !== pointerId) {
          return;
        }

        pointerStatesRef.current.get(pointerId)?.drag.finish();
        cleanup();
      }

      function handleWindowBlur() {
        pointerStatesRef.current.get(pointerId)?.drag.finish();
        cleanup();
      }

      cleanupsRef.current.add(cleanup);
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
      window.addEventListener("blur", handleWindowBlur);
      pointerCaptureElement.addEventListener("lostpointercapture", handlePointerUp);
    },
    [containerSize, direction, groupId, index, onPreviewResizeSplit, onResizeSplit, sizes],
  );

  const touchGesture = useMemo(() => {
    const gesture = Gesture.Pan()
      .runOnJS(true)
      .onBegin(() => setDragging(true))
      .onStart(() => {
        releaseTouchInputRef.current = suspendResidentBrowserSurfaceInput();
        touchDragRef.current = startResizeHandleDrag({
          sizes,
          index,
          preview: (nextSizes) => onPreviewResizeSplit(groupId, nextSizes),
          commit: (nextSizes) => onResizeSplit(groupId, nextSizes),
        });
      })
      .onUpdate((event) => {
        if (containerSize <= 0) return;
        const translation = direction === "horizontal" ? event.translationX : event.translationY;
        touchDragRef.current?.move(translation / containerSize);
      })
      .onEnd(() => touchDragRef.current?.finish())
      .onFinalize(() => {
        releaseTouchInputRef.current?.();
        releaseTouchInputRef.current = null;
        touchDragRef.current = null;
        setDragging(false);
      });

    return direction === "horizontal"
      ? gesture
          .activeOffsetX([-SIDEBAR_RESIZE_ACTIVATION_OFFSET, SIDEBAR_RESIZE_ACTIVATION_OFFSET])
          .failOffsetY([-SIDEBAR_RESIZE_FAIL_OFFSET, SIDEBAR_RESIZE_FAIL_OFFSET])
      : gesture
          .activeOffsetY([-SIDEBAR_RESIZE_ACTIVATION_OFFSET, SIDEBAR_RESIZE_ACTIVATION_OFFSET])
          .failOffsetX([-SIDEBAR_RESIZE_FAIL_OFFSET, SIDEBAR_RESIZE_FAIL_OFFSET]);
  }, [containerSize, direction, groupId, index, onPreviewResizeSplit, onResizeSplit, sizes]);

  const handlePointerEnter = useCallback(() => {
    hoverTimerRef.current = setTimeout(() => {
      setActive(true);
    }, 150);
  }, []);

  const handlePointerLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setActive(false);
  }, []);

  const handleStyle = useMemo(
    () => [
      styles.handle,
      direction === "horizontal" ? styles.handleHorizontal : styles.handleVertical,
    ],
    [direction],
  );
  const highlightStyle = useMemo(
    () => [
      styles.highlight,
      direction === "horizontal" ? styles.highlightHorizontal : styles.highlightVertical,
    ],
    [direction],
  );
  const hitAreaStyle = useMemo(
    () => [
      styles.hitArea,
      direction === "horizontal" ? styles.hitAreaHorizontal : styles.hitAreaVertical,
      {
        ...(direction === "horizontal"
          ? { left: hitAreaAlignment === "end" ? 0 : -5 }
          : { top: hitAreaAlignment === "end" ? 0 : -5 }),
        cursor: direction === "horizontal" ? "col-resize" : "row-resize",
        touchAction: "none",
      } as object,
    ],
    [direction, hitAreaAlignment],
  );
  const touchHitAreaStyle = useMemo(
    () => [
      styles.touchHitArea,
      direction === "horizontal" ? styles.touchHitAreaHorizontal : styles.touchHitAreaVertical,
      {
        ...(direction === "horizontal"
          ? { left: hitAreaAlignment === "end" ? 0 : -12 }
          : { top: hitAreaAlignment === "end" ? 0 : -12 }),
        touchAction: "none",
      } as object,
    ],
    [direction, hitAreaAlignment],
  );
  const touchGripStyle = useMemo(
    () => [
      styles.touchGrip,
      direction === "horizontal" ? styles.touchGripHorizontal : styles.touchGripVertical,
      highlighted ? styles.touchGripVisible : styles.touchGripHidden,
    ],
    [direction, highlighted],
  );

  return (
    <View style={handleStyle} testID={testID}>
      <PaneOverlay>
        {highlighted && (
          <View
            pointerEvents="none"
            style={highlightStyle}
            testID={testID ? `${testID}-highlight` : undefined}
          />
        )}
        {finePointer ? (
          <View
            role="separator"
            aria-orientation={direction === "horizontal" ? "vertical" : "horizontal"}
            style={hitAreaStyle}
            onPointerDown={handlePointerDown}
            onPointerEnter={handlePointerEnter}
            onPointerLeave={handlePointerLeave}
          />
        ) : (
          <GestureDetector gesture={touchGesture}>
            <View
              role="separator"
              aria-orientation={direction === "horizontal" ? "vertical" : "horizontal"}
              collapsable={false}
              style={touchHitAreaStyle}
            >
              <View pointerEvents="none" style={touchGripStyle} />
            </View>
          </GestureDetector>
        )}
      </PaneOverlay>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  handle: {
    backgroundColor: theme.colors.border,
    position: "relative",
    flexShrink: 0,
    zIndex: 10,
  },
  handleHorizontal: {
    width: 1,
    alignSelf: "stretch",
  },
  handleVertical: {
    height: 1,
    width: "100%",
  },
  highlight: {
    backgroundColor: theme.colors.accent,
    position: "absolute",
    zIndex: 5,
  },
  highlightHorizontal: {
    top: 0,
    bottom: 0,
    width: 1,
    left: 0,
  },
  highlightVertical: {
    left: 0,
    right: 0,
    height: 1,
    top: 0,
  },
  hitArea: {
    position: "absolute",
    zIndex: 10,
  },
  // 11px band centered on the 1px line (5px each side): -5..+6 around 0..1.
  // An even width can't center on an odd line - the old 10px box sat half a
  // pixel off, biasing the grab band left/up of the visible divider.
  hitAreaHorizontal: {
    top: 0,
    bottom: 0,
    width: 11,
  },
  hitAreaVertical: {
    left: 0,
    right: 0,
    height: 11,
  },
  touchHitArea: {
    position: "absolute",
    zIndex: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  touchHitAreaHorizontal: {
    top: "50%",
    width: 24,
    height: 88,
    transform: [{ translateY: -44 }],
  },
  touchHitAreaVertical: {
    left: "50%",
    width: 88,
    height: 24,
    transform: [{ translateX: -44 }],
  },
  touchGrip: {
    backgroundColor: theme.colors.foreground,
    borderRadius: 2,
  },
  touchGripHorizontal: {
    width: 4,
    height: 36,
  },
  touchGripVertical: {
    width: 36,
    height: 4,
  },
  touchGripHidden: {
    opacity: 0.12,
  },
  touchGripVisible: {
    opacity: 0.3,
  },
}));
