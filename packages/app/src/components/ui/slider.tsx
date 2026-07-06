import { useCallback, useMemo, useRef, useState } from "react";
import {
  PanResponder,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PointerEvent as RNPointerEvent,
  type ViewStyle,
  View,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb as platformIsWeb } from "@/constants/platform";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Maps a 0..1 position along the track to a clamped, stepped value.
function valueFromRatio(ratio: number, min: number, max: number, step: number): number {
  const raw = min + clamp(ratio, 0, 1) * (max - min);
  return clamp(min + Math.round((raw - min) / step) * step, min, max);
}

const THUMB_SIZE = 18;
const TRACK_HEIGHT = 4;
const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

export interface SliderProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  onValueChange: (value: number) => void;
  onSlidingComplete?: (value: number) => void;
  accessibilityLabel?: string;
  testID?: string;
}

// Cross-platform drag slider (no third-party slider dependency in this repo).
// Value is always derived from the pointer's position relative to the
// bound element itself — never from a DOM event's target-relative
// `offsetX`, which resolves against whichever overlapping child (track,
// fill, or thumb) happened to receive the click and silently produced
// wrong values. Web measures `event.currentTarget` directly (same fix as
// `resize-handle.tsx`'s `handlePointerDown`); native's PanResponder
// `locationX` is already relative to the responder view, not a DOM node.
export function Slider({
  min,
  max,
  step = 1,
  value,
  onValueChange,
  onSlidingComplete,
  accessibilityLabel,
  testID,
}: SliderProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const trackWidthRef = useRef(0);
  const trackLeftRef = useRef(0);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onValueChangeRef = useRef(onValueChange);
  onValueChangeRef.current = onValueChange;
  const onSlidingCompleteRef = useRef(onSlidingComplete);
  onSlidingCompleteRef.current = onSlidingComplete;

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    trackWidthRef.current = width;
    setTrackWidth(width);
  }, []);

  const commitFromLocalX = useCallback(
    (localX: number, width: number) => {
      if (width <= 0) return;
      const next = valueFromRatio(localX / width, min, max, step);
      if (next !== valueRef.current) {
        onValueChangeRef.current(next);
      }
    },
    [min, max, step],
  );

  const panResponder = useMemo(() => {
    if (platformIsWeb) return null;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event: GestureResponderEvent) => {
        setIsDragging(true);
        commitFromLocalX(event.nativeEvent.locationX, trackWidthRef.current);
      },
      onPanResponderMove: (event: GestureResponderEvent) => {
        commitFromLocalX(event.nativeEvent.locationX, trackWidthRef.current);
      },
      onPanResponderRelease: () => {
        setIsDragging(false);
        onSlidingCompleteRef.current?.(valueRef.current);
      },
      onPanResponderTerminate: () => {
        setIsDragging(false);
      },
    });
  }, [commitFromLocalX]);

  // Measures the bound element itself at gesture start and reuses that rect
  // for the whole drag, so `currentTarget` ambiguity from nested children
  // (track/fill/thumb) never leaks into per-move computations either.
  const startWebDrag = useCallback(
    (event: RNPointerEvent) => {
      const currentTarget = event.currentTarget as unknown as HTMLElement | null;
      if (!currentTarget) return;
      const element: HTMLElement = currentTarget;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      trackLeftRef.current = rect.left;
      trackWidthRef.current = rect.width;
      setIsDragging(true);
      commitFromLocalX(event.nativeEvent.clientX - rect.left, rect.width);

      const pointerId = event.nativeEvent.pointerId;
      element.setPointerCapture?.(pointerId);

      function handlePointerMove(moveEvent: PointerEvent) {
        if (moveEvent.pointerId !== pointerId) return;
        commitFromLocalX(moveEvent.clientX - trackLeftRef.current, trackWidthRef.current);
      }
      function stopDragging(upEvent: PointerEvent) {
        if (upEvent.pointerId !== pointerId) return;
        setIsDragging(false);
        onSlidingCompleteRef.current?.(valueRef.current);
        if (element.hasPointerCapture?.(pointerId)) {
          element.releasePointerCapture(pointerId);
        }
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopDragging);
        window.removeEventListener("pointercancel", stopDragging);
      }
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopDragging);
      window.addEventListener("pointercancel", stopDragging);
    },
    [commitFromLocalX],
  );

  const percent = max > min ? clamp((value - min) / (max - min), 0, 1) : 0;
  const thumbCenter = percent * trackWidth;

  const containerStyle = useMemo(
    () => [
      styles.container,
      platformIsWeb &&
        inlineUnistylesStyle({
          touchAction: "none",
          userSelect: "none",
        } as unknown as ViewStyle),
    ],
    [],
  );
  const fillStyle = useMemo(
    () => [styles.fill, inlineUnistylesStyle({ width: thumbCenter })],
    [thumbCenter],
  );
  const thumbStyle = useMemo(
    () => [
      styles.thumb,
      inlineUnistylesStyle({
        transform: [{ translateX: thumbCenter - THUMB_SIZE / 2 }],
        opacity: isDragging ? 0.85 : 1,
      }),
    ],
    [thumbCenter, isDragging],
  );

  const accessibilityValue = useMemo(() => ({ min, max, now: value }), [min, max, value]);

  return (
    <View
      style={containerStyle}
      onLayout={onLayout}
      hitSlop={HIT_SLOP}
      {...(panResponder?.panHandlers ?? {})}
      {...(platformIsWeb ? ({ onPointerDown: startWebDrag } as object) : null)}
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={accessibilityValue}
      testID={testID}
    >
      <View style={styles.track}>
        <View style={fillStyle} />
      </View>
      <View style={thumbStyle} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 120,
    height: THUMB_SIZE,
    justifyContent: "center",
  },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: theme.colors.surface3,
    overflow: "hidden",
  },
  fill: {
    height: TRACK_HEIGHT,
    backgroundColor: theme.colors.accent,
  },
  thumb: {
    position: "absolute",
    top: 0,
    left: 0,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: theme.colors.accent,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
}));
