// Web renderer for the loading-skeleton shimmer. One keyframe is registered
// once for the whole app and every leaf rides it, so the placeholder costs
// nothing per frame: the compositor animates opacity and React never re-renders
// while it loops.
//
// This exists because react-native-web has no native animated module, so
// `useNativeDriver` can never take effect. Its JS fallback drives animations by
// calling a useReducer dispatch on every attached component once per frame
// (vendor/react-native/Animated/useAnimatedProps.js), which turns an
// indefinitely looping placeholder into a per-frame React re-render of every
// one of its leaves.
//
// See skeleton-pulse.tsx for the native counterpart.

import { useEffect, useMemo } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { useAnimationsEnabled } from "@/hooks/use-animations-enabled";
import {
  SKELETON_PULSE_HALF_CYCLE_MS,
  SKELETON_PULSE_MAX_OPACITY,
  SKELETON_PULSE_MIN_OPACITY,
  type SkeletonPulseDriver,
} from "./skeleton-pulse.shared";

export type { SkeletonPulseDriver };

const PULSE_KEYFRAME_ID = "otto-skeleton-pulse-keyframes";
const PULSE_ANIMATION_NAME = "otto-skeleton-pulse";
const PULSE_CYCLE_MS = SKELETON_PULSE_HALF_CYCLE_MS * 2;

// `ease-in-out` applies per segment, matching the two sequenced Animated.timing
// calls on the native side, so both platforms breathe on the same curve.
const PULSE_KEYFRAME_CSS = `
  @keyframes ${PULSE_ANIMATION_NAME} {
    0% { opacity: ${SKELETON_PULSE_MIN_OPACITY}; }
    50% { opacity: ${SKELETON_PULSE_MAX_OPACITY}; }
    100% { opacity: ${SKELETON_PULSE_MIN_OPACITY}; }
  }
`;

let pulseKeyframesRegistered = false;

function ensurePulseKeyframes() {
  if (typeof document === "undefined") {
    return;
  }
  const existing = document.getElementById(PULSE_KEYFRAME_ID);
  if (existing) {
    if (existing.textContent !== PULSE_KEYFRAME_CSS) {
      existing.textContent = PULSE_KEYFRAME_CSS;
    }
    pulseKeyframesRegistered = true;
    return;
  }
  if (pulseKeyframesRegistered) {
    return;
  }
  const styleElement = document.createElement("style");
  styleElement.id = PULSE_KEYFRAME_ID;
  styleElement.textContent = PULSE_KEYFRAME_CSS;
  document.head.appendChild(styleElement);
  pulseKeyframesRegistered = true;
}

// Module-level constants: every leaf shares one style object, so the leaf memo
// stays stable and react-native-web resolves the same class for all of them.
const ANIMATED_PULSE_STYLE = {
  opacity: SKELETON_PULSE_MIN_OPACITY,
  animation: `${PULSE_ANIMATION_NAME} ${PULSE_CYCLE_MS}ms ease-in-out infinite`,
} as object;

const RESTING_PULSE_STYLE = { opacity: SKELETON_PULSE_MIN_OPACITY };

/** Web has no JS clock to share - the keyframe is the clock, so `value` is null. */
export function useSkeletonPulse(): SkeletonPulseDriver {
  const animated = useAnimationsEnabled();

  useEffect(() => {
    ensurePulseKeyframes();
  }, []);

  return useMemo(() => ({ animated, value: null }), [animated]);
}

export function SkeletonPulse({
  pulse,
  style,
}: {
  pulse: SkeletonPulseDriver;
  style: StyleProp<ViewStyle>;
}) {
  const pulseStyle = useMemo(
    () => [style, pulse.animated ? ANIMATED_PULSE_STYLE : RESTING_PULSE_STYLE],
    [style, pulse.animated],
  );

  return <View style={pulseStyle} />;
}
