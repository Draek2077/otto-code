// Native renderer for the kind: "glyph" text effect (Matrix rain).
//
// The perf shape is the point: the overlay owns exactly ONE shared value — a
// linear 0→1 sawtooth — and every column derives its own style from it by
// subtracting its staggered phase. One animation driver per badge, worklets on
// the UI thread, no JS per frame, and no re-render while the strip travels.
//
// See text-effect-rain.web.tsx for the CSS counterpart; both derive their
// timeline from GLYPH_EFFECT_PHASES so they cannot drift.

import { memo, useEffect, useMemo } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  Extrapolation,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { GLYPH_EFFECT_CUT, GLYPH_EFFECT_PHASES } from "@/styles/text-effects";
import {
  buildRainColumns,
  rainStylesheet,
  type RainColumn,
  type TextEffectRainProps,
} from "./text-effect-rain.shared";

const { arrive, swap, fade } = GLYPH_EFFECT_PHASES;

// The same stops the web keyframes use, as interpolation input ranges.
const GLYPH_A_INPUT = [0, arrive, swap - GLYPH_EFFECT_CUT, swap, 1];
const GLYPH_A_OUTPUT = [0, 1, 1, 0, 0];
const GLYPH_B_INPUT = [0, swap - GLYPH_EFFECT_CUT, swap, fade, 1];
const GLYPH_B_OUTPUT = [0, 0, 1, 0, 0];

/** Where this column sits in the cycle, given the overlay-wide progress. */
function columnPhase(progress: number, index: number, staggerFraction: number): number {
  "worklet";
  const phase = (progress - index * staggerFraction) % 1;
  return phase < 0 ? phase + 1 : phase;
}

interface NativeRainColumnProps {
  column: RainColumn;
  progress: SharedValue<number>;
  staggerFraction: number;
  cellWidth: number;
  headColor: string;
  tailColor: string;
}

const NativeRainColumn = memo(function NativeRainColumn({
  column,
  progress,
  staggerFraction,
  cellWidth,
  headColor,
  tailColor,
}: NativeRainColumnProps) {
  const { index } = column;

  const glyphAAnimatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      columnPhase(progress.value, index, staggerFraction),
      GLYPH_A_INPUT,
      GLYPH_A_OUTPUT,
      Extrapolation.CLAMP,
    ),
  }));

  const glyphBAnimatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      columnPhase(progress.value, index, staggerFraction),
      GLYPH_B_INPUT,
      GLYPH_B_OUTPUT,
      Extrapolation.CLAMP,
    ),
  }));

  const columnStyle = useMemo(() => [rainStylesheet.column, { width: cellWidth }], [cellWidth]);

  const glyphAStyle = useMemo(
    () => [rainStylesheet.glyph, { color: headColor }, glyphAAnimatedStyle],
    [headColor, glyphAAnimatedStyle],
  );

  const glyphBStyle = useMemo(
    () => [rainStylesheet.glyphOverlaid, { color: tailColor }, glyphBAnimatedStyle],
    [tailColor, glyphBAnimatedStyle],
  );

  return (
    <View style={columnStyle}>
      <Animated.Text style={glyphAStyle}>{column.glyphA}</Animated.Text>
      <Animated.Text style={glyphBStyle}>{column.glyphB}</Animated.Text>
    </View>
  );
});

export const TextEffectRain = memo(function TextEffectRain({
  effect,
  offsetX,
  width,
  seed,
}: TextEffectRainProps) {
  const progress = useSharedValue(0);
  const { cycleSeconds } = effect;

  useEffect(() => {
    progress.value = 0;
    progress.value = withRepeat(
      // Linear sawtooth: reverse=false restarts each cycle, so the strip always
      // travels the same direction. Timing keeps its ReduceMotion.System
      // default, matching the sweep renderer under OS reduced-motion.
      withTiming(1, { duration: cycleSeconds * 1000, easing: Easing.linear }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(progress);
    };
  }, [cycleSeconds, progress]);

  const columns = useMemo(
    () => buildRainColumns(width, effect.cellWidth, effect.scrambleAlphabet, seed),
    [width, effect.cellWidth, effect.scrambleAlphabet, seed],
  );

  const staggerFraction = effect.staggerSeconds / effect.cycleSeconds;

  const overlayStyle = useMemo(
    () => [rainStylesheet.overlay, { left: offsetX, width }],
    [offsetX, width],
  );

  if (columns.length === 0) {
    return null;
  }

  return (
    <View style={overlayStyle} pointerEvents="none">
      {columns.map((column) => (
        <NativeRainColumn
          key={column.key}
          column={column}
          progress={progress}
          staggerFraction={staggerFraction}
          cellWidth={effect.cellWidth}
          headColor={effect.headColor}
          tailColor={effect.tailColor}
        />
      ))}
    </View>
  );
});
