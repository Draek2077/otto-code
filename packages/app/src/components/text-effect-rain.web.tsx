// Web renderer for the kind: "glyph" text effect (Matrix rain). Fully
// declarative: two keyframes are registered once for the whole app, every
// column rides the same ones, and the only thing that varies per column is a
// negative `animation-delay`. No JS per frame, no state — the overlay
// re-renders only when the measured text span changes.
//
// See text-effect-rain.tsx for the native counterpart.

import { memo, useEffect, useMemo } from "react";
import { Text, View, type StyleProp, type TextStyle } from "react-native";
import { GLYPH_EFFECT_CUT, GLYPH_EFFECT_PHASES } from "@/styles/text-effects";
import {
  buildRainColumns,
  rainStylesheet,
  type RainColumn,
  type TextEffectRainProps,
} from "./text-effect-rain.shared";

const RAIN_KEYFRAME_ID = "otto-matrix-rain-keyframes";
const RAIN_A_ANIMATION_NAME = "otto-matrix-rain-a";
const RAIN_B_ANIMATION_NAME = "otto-matrix-rain-b";

function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(3)}%`;
}

const { arrive, swap, fade } = GLYPH_EFFECT_PHASES;

// Built from GLYPH_EFFECT_PHASES so the CSS timeline and the native
// interpolation are literally the same numbers. Colors are set per element
// rather than in the keyframes, so the keyframes stay theme-independent.
const RAIN_KEYFRAME_CSS = `
  @keyframes ${RAIN_A_ANIMATION_NAME} {
    0% { opacity: 0; }
    ${pct(arrive)} { opacity: 1; }
    ${pct(swap - GLYPH_EFFECT_CUT)} { opacity: 1; }
    ${pct(swap)} { opacity: 0; }
    100% { opacity: 0; }
  }
  @keyframes ${RAIN_B_ANIMATION_NAME} {
    0% { opacity: 0; }
    ${pct(swap - GLYPH_EFFECT_CUT)} { opacity: 0; }
    ${pct(swap)} { opacity: 1; }
    ${pct(fade)} { opacity: 0; }
    100% { opacity: 0; }
  }
`;

let rainKeyframesRegistered = false;

function ensureRainKeyframes() {
  if (typeof document === "undefined") {
    return;
  }
  const existing = document.getElementById(RAIN_KEYFRAME_ID);
  if (existing) {
    if (existing.textContent !== RAIN_KEYFRAME_CSS) {
      existing.textContent = RAIN_KEYFRAME_CSS;
    }
    rainKeyframesRegistered = true;
    return;
  }
  if (rainKeyframesRegistered) {
    return;
  }
  const styleElement = document.createElement("style");
  styleElement.id = RAIN_KEYFRAME_ID;
  styleElement.textContent = RAIN_KEYFRAME_CSS;
  document.head.appendChild(styleElement);
  rainKeyframesRegistered = true;
}

/**
 * Negative delay so column `index` is already `index * stagger` seconds into
 * the cycle at mount — a positive delay would leave the row dark until the
 * strip caught up with it.
 */
function columnDelaySeconds(index: number, staggerSeconds: number, cycleSeconds: number): number {
  const offset = (index * staggerSeconds) % cycleSeconds;
  return offset === 0 ? 0 : offset - cycleSeconds;
}

interface WebRainColumnProps {
  column: RainColumn;
  cellWidth: number;
  cycleSeconds: number;
  staggerSeconds: number;
  headColor: string;
  tailColor: string;
}

const WebRainColumn = memo(function WebRainColumn({
  column,
  cellWidth,
  cycleSeconds,
  staggerSeconds,
  headColor,
  tailColor,
}: WebRainColumnProps) {
  // One timing string for both layers: same cycle, same delay, different
  // keyframes — they are complementary windows of the same timeline.
  const timing = useMemo(() => {
    const delay = columnDelaySeconds(column.index, staggerSeconds, cycleSeconds);
    return `${cycleSeconds}s linear ${delay}s infinite`;
  }, [column.index, cycleSeconds, staggerSeconds]);

  const columnStyle = useMemo(() => [rainStylesheet.column, { width: cellWidth }], [cellWidth]);

  const glyphAStyle = useMemo<StyleProp<TextStyle>>(
    () => [
      rainStylesheet.glyph,
      { color: headColor, animation: `${RAIN_A_ANIMATION_NAME} ${timing}` } as object,
    ],
    [headColor, timing],
  );

  const glyphBStyle = useMemo<StyleProp<TextStyle>>(
    () => [
      rainStylesheet.glyphOverlaid,
      { color: tailColor, animation: `${RAIN_B_ANIMATION_NAME} ${timing}` } as object,
    ],
    [tailColor, timing],
  );

  return (
    <View style={columnStyle}>
      <Text style={glyphAStyle}>{column.glyphA}</Text>
      <Text style={glyphBStyle}>{column.glyphB}</Text>
    </View>
  );
});

export const TextEffectRain = memo(function TextEffectRain({
  effect,
  offsetX,
  width,
  seed,
}: TextEffectRainProps) {
  useEffect(() => {
    ensureRainKeyframes();
  }, []);

  const columns = useMemo(
    () => buildRainColumns(width, effect.cellWidth, effect.scrambleAlphabet, seed),
    [width, effect.cellWidth, effect.scrambleAlphabet, seed],
  );

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
        <WebRainColumn
          key={column.key}
          column={column}
          cellWidth={effect.cellWidth}
          cycleSeconds={effect.cycleSeconds}
          staggerSeconds={effect.staggerSeconds}
          headColor={effect.headColor}
          tailColor={effect.tailColor}
        />
      ))}
    </View>
  );
});
