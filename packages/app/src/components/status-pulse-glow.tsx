import { useEffect, useId, useMemo, type PropsWithChildren, type ReactElement } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { StyleSheet } from "react-native-unistyles";
import { useAnimationsEnabled } from "@/hooks/use-animations-enabled";

const PULSE_DURATION_MS = 1500;
/** The halo is drawn this much larger than the glyph it sits behind. */
const GLOW_RATIO = 1.75;
/**
 * Opacity floor and ceiling of the breath. A static notice uses the peak frame
 * so the halo remains clearly visible when the animation is disabled.
 */
const GLOW_RESTING_OPACITY = 0.68;
const GLOW_PEAK_OPACITY = 1;
const GLOW_RESTING_SCALE = 0.9;
const GLOW_PEAK_SCALE = 1;

/**
 * A pulsing halo behind a status glyph, tinted with the glyph's own colour so
 * the halo always matches whatever the glyph is saying at that moment.
 *
 * `color` is null for resting states - nothing is being reported, so nothing
 * glows. Callers pass the concrete hex string their icon resolves to, which is
 * what keeps the halo in lockstep with the glyph across any number of states
 * without the halo knowing about them.
 *
 * Motion is gated on Appearance -> Animations: with animations off the halo
 * still renders, held at the breath's peak frame. The status is the point,
 * the movement is the emphasis, and only the emphasis is optional.
 */
export function StatusPulseGlow({
  color,
  size,
  children,
}: PropsWithChildren<{
  /** The glyph's current colour, or null to draw no halo. */
  color: string | null;
  /** The laid-out glyph the halo is sized against. */
  size: number;
}>): ReactElement {
  const gradientId = useId();
  const animationsEnabled = useAnimationsEnabled();
  const active = color !== null && animationsEnabled;
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      cancelAnimation(progress);
      // Keep the non-animated variant at the most visible point of the pulse.
      progress.value = 1;
      return;
    }
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, {
        duration: PULSE_DURATION_MS,
        easing: Easing.inOut(Easing.quad),
        // The app's own Animations setting is this effect's gate. The OS-level
        // reduce-motion flag is declined here for the same reason the Brain icon
        // declines it: headless Chromium reports `prefers-reduced-motion:
        // reduce`, which would freeze the halo in every Playwright run.
        reduceMotion: ReduceMotion.Never,
      }),
      -1,
      true,
      // reduceMotion is the 5th argument of withRepeat and MUST be set here too.
      // Reanimated fills an unset value in from the *system* setting, and a
      // truthy one on the repeat wrapper ends an infinite loop after a single
      // cycle. It propagates parent -> child only, so the Never above does not
      // cover the wrapper. See useSweepProgress in brain-state-icon.tsx.
      undefined,
      ReduceMotion.Never,
    );
    return () => {
      cancelAnimation(progress);
    };
  }, [active, progress]);

  const breathStyle = useAnimatedStyle(() => ({
    opacity: GLOW_RESTING_OPACITY + progress.value * (GLOW_PEAK_OPACITY - GLOW_RESTING_OPACITY),
    transform: [
      { scale: GLOW_RESTING_SCALE + progress.value * (GLOW_PEAK_SCALE - GLOW_RESTING_SCALE) },
    ],
  }));

  const extent = size * GLOW_RATIO;
  const haloStyle = useMemo(() => ({ width: extent, height: extent }), [extent]);

  return (
    <View style={styles.container}>
      {color !== null ? (
        // Absolutely filled and centred rather than sized to the glyph: the halo
        // overflows the glyph on every edge and must not push the trigger wider.
        <View pointerEvents="none" style={styles.overlay}>
          <Animated.View style={[haloStyle, breathStyle]}>
            <Svg width={extent} height={extent} pointerEvents="none">
              <Defs>
                <RadialGradient id={gradientId} cx="50%" cy="50%" r="50%">
                  <Stop offset="0%" stopColor={color} stopOpacity={0.38} />
                  <Stop offset="38%" stopColor={color} stopOpacity={0.24} />
                  <Stop offset="70%" stopColor={color} stopOpacity={0.08} />
                  <Stop offset="100%" stopColor={color} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Rect x={0} y={0} width={extent} height={extent} fill={`url(#${gradientId})`} />
            </Svg>
          </Animated.View>
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  container: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
}));
