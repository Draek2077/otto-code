// Native renderer for the loading-skeleton shimmer. One Animated.Value per
// skeleton drives every leaf, so the whole placeholder pulses in phase off a
// single native-driven loop.
//
// See skeleton-pulse.web.tsx for the web counterpart, which uses a CSS keyframe
// instead: react-native-web has no native animated module, and its JS fallback
// re-renders every animated component once per frame (useAnimatedProps
// schedules a useReducer dispatch from the driver), which is far too expensive
// for a placeholder that loops indefinitely.

import { useEffect, useMemo, useRef } from "react";
import { Animated, type StyleProp, type ViewStyle } from "react-native";
import { isNative } from "@/constants/platform";
import { useAnimationsEnabled } from "@/hooks/use-animations-enabled";
import {
  SKELETON_PULSE_HALF_CYCLE_MS,
  SKELETON_PULSE_MAX_OPACITY,
  SKELETON_PULSE_MIN_OPACITY,
  type SkeletonPulseDriver,
} from "./skeleton-pulse.shared";

export type { SkeletonPulseDriver };

export function useSkeletonPulse(): SkeletonPulseDriver {
  const animated = useAnimationsEnabled();
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animated) {
      // Rest at the bottom of the pulse - the same frame the loop starts from,
      // so switching Animations off never makes the placeholder jump.
      value.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: 1,
          duration: SKELETON_PULSE_HALF_CYCLE_MS,
          // This module is the non-web build, but it is also what a jsdom test
          // env resolves, so keep the gate rather than hardcoding true.
          useNativeDriver: isNative,
        }),
        Animated.timing(value, {
          toValue: 0,
          duration: SKELETON_PULSE_HALF_CYCLE_MS,
          useNativeDriver: isNative,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [value, animated]);

  return useMemo(() => ({ animated, value }), [animated, value]);
}

export function SkeletonPulse({
  pulse,
  style,
}: {
  pulse: SkeletonPulseDriver;
  style: StyleProp<ViewStyle>;
}) {
  const opacity = useMemo(
    () =>
      pulse.animated && pulse.value
        ? pulse.value.interpolate({
            inputRange: [0, 1],
            outputRange: [SKELETON_PULSE_MIN_OPACITY, SKELETON_PULSE_MAX_OPACITY],
          })
        : SKELETON_PULSE_MIN_OPACITY,
    [pulse],
  );
  const pulseStyle = useMemo(() => [style, { opacity }], [style, opacity]);

  return <Animated.View style={pulseStyle} />;
}
