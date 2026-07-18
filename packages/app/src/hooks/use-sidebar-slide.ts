import { useEffect, useState } from "react";
import {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { SIDEBAR_SLIDE_DURATION_MS } from "@/constants/animation";
import { useAnimationsEnabled } from "@/hooks/use-animations-enabled";

/**
 * Drives the open/close slide for a desktop sidebar whose layout width is a
 * Reanimated shared value (the same value the resize gesture writes). When
 * animations are enabled it cross-slides the width and fades opacity over
 * SIDEBAR_SLIDE_DURATION_MS, keeping the sidebar mounted until the close
 * animation finishes; when disabled it snaps open/closed exactly like the
 * pre-animation behavior (immediate unmount on close).
 *
 * Returns:
 *  - `rendered`: true while the sidebar should be in the tree — whenever open,
 *    and during the close animation so the exit can play before it unmounts.
 *    Gate the component's `return null` on this instead of `isOpen`.
 *  - `slideStyle`: the Reanimated style for the sidebar's outer Animated.View
 *    (animated width + opacity). Only the outer container is animated — inner
 *    content stays on Unistyles styles, per the "Animated.Views must not use
 *    Unistyles dynamic theme" crash gotcha. The return type is inferred (not
 *    annotated) so it stays the concrete `useAnimatedStyle` result and composes
 *    in the consumers' `[staticStyle, slideStyle]` arrays.
 */
export function useSidebarSlide({
  isOpen,
  width,
}: {
  isOpen: boolean;
  width: SharedValue<number>;
}) {
  const animationsEnabled = useAnimationsEnabled();
  const openProgress = useSharedValue(isOpen ? 1 : 0);
  const [rendered, setRendered] = useState(isOpen);

  useEffect(() => {
    if (isOpen) {
      setRendered(true);
      openProgress.value = animationsEnabled
        ? withTiming(1, { duration: SIDEBAR_SLIDE_DURATION_MS })
        : 1;
      return;
    }
    if (!animationsEnabled) {
      // Snap shut and unmount immediately — matches the original `!isOpen`
      // return-null behavior when the setting is off.
      openProgress.value = 0;
      setRendered(false);
      return;
    }
    openProgress.value = withTiming(0, { duration: SIDEBAR_SLIDE_DURATION_MS }, (finished) => {
      // Only unmount once the exit actually completed; an interrupted close
      // (reopened mid-animation) leaves `rendered` true and re-runs this effect.
      if (finished) {
        runOnJS(setRendered)(false);
      }
    });
  }, [isOpen, animationsEnabled, openProgress]);

  const slideStyle = useAnimatedStyle(() => ({
    width: width.value * openProgress.value,
    opacity: openProgress.value,
  }));

  return { rendered, slideStyle };
}
