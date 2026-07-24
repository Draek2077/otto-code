// Shared pieces of the kind: "glyph" text-effect renderer (Matrix rain). The
// two platform implementations live in text-effect-rain.tsx (native,
// reanimated) and text-effect-rain.web.tsx (CSS keyframes); everything that
// must not drift between them lives here.
//
// The rain is pure decoration drawn over the label — it never reads, splits, or
// replaces the text. Columns are a fixed pitch across the measured text span,
// so a 4-character label and a 40-character one cost the same per column.
//
// See projects/text-effects/text-effects.md and styles/text-effects.ts
// (GLYPH_EFFECT_PHASES is the one timeline both renderers derive from).

import { StyleSheet } from "react-native-unistyles";
import type { GlyphTextEffectSpec } from "@/styles/text-effects";

export interface TextEffectRainProps {
  effect: GlyphTextEffectSpec;
  /** Left edge of the text span within the label row, in px. */
  offsetX: number;
  /** Width of the text span (label, or label through secondary label), in px. */
  width: number;
  /**
   * Varies the rain between badges so two rows running at once don't show the
   * same glyphs. Only the *characters* depend on it — never the layout.
   */
  seed: string;
}

export interface RainColumn {
  key: string;
  /** Stagger slot: column `index` runs the timeline `index * stagger` late. */
  index: number;
  /** Shown as the strip arrives. */
  glyphA: string;
  /** Swaps in behind it, then fades — the trailing half of the cycle. */
  glyphB: string;
}

/**
 * Hard ceiling on animated columns. Native pays two derived styles per column
 * (UI thread, but still per-frame work), so a very wide badge degrades to a
 * sparser strip rather than quietly costing hundreds of worklet evaluations.
 *
 * Set high enough that real single-line tool-call labels never reach it: at the
 * 7px Matrix pitch this covers ~900px of text. The old 48 was hit by any label
 * past ~380px, and because the overflow is absorbed by *widening* the pitch
 * (see buildRainColumns), that made long labels visibly less dense than short
 * ones — the same effect reading differently depending on how much text it
 * happened to be sitting on.
 */
export const MAX_RAIN_COLUMNS = 128;

function hashSeed(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return hash;
}

// Deterministic pick, so the column list is a pure function of its inputs and a
// re-render mid-stream never reshuffles the rain.
function pickGlyph(alphabet: string, value: number): string {
  let hash = (value + 0x9e3779b9) | 0;
  hash ^= hash << 13;
  hash ^= hash >>> 17;
  hash ^= hash << 5;
  return alphabet.charAt(Math.abs(hash) % alphabet.length);
}

export interface RainLayout {
  columns: readonly RainColumn[];
  /**
   * Pitch that makes `columns` span the full measured `width` exactly. Equals
   * the requested `cellWidth` for normal labels; on a label wide enough to hit
   * MAX_RAIN_COLUMNS the cells widen instead, so the rain still reaches the end
   * of the line rather than stopping short at the column cap.
   */
  cellWidth: number;
}

export function buildRainColumns(
  width: number,
  cellWidth: number,
  alphabet: string,
  seed: string,
): RainLayout {
  const count = Math.min(MAX_RAIN_COLUMNS, Math.max(0, Math.ceil(width / cellWidth)));
  // Spread the (capped) columns across the whole width so they always reach the
  // end. The animation is unchanged — only the per-column pitch adapts.
  const spanCellWidth = count > 0 ? width / count : cellWidth;
  const seedValue = hashSeed(seed);
  const columns = Array.from({ length: count }, (_unused, index) => ({
    key: `${index}`,
    index,
    glyphA: pickGlyph(alphabet, seedValue + index * 2 + 1),
    glyphB: pickGlyph(alphabet, seedValue + index * 2 + 977),
  }));
  return { columns, cellWidth: spanCellWidth };
}

export const rainStylesheet = StyleSheet.create((theme) => ({
  // Absolutely positioned over the label row and clipped to it, so the rain can
  // never change the row's size or push the text around. Horizontal and one
  // line tall by construction: there is nowhere for a vertical drip to go on a
  // single-line label.
  overlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    // The glyph line box centers a hair above the label's own optical center
    // (cap-height vs. the label's x-height run), which reads as the rain
    // floating above the text. One pixel down sits it on the text.
    transform: [{ translateY: 1 }],
  },
  column: {
    position: "relative",
  },
  // glyphA sits in flow and gives the column its line box; glyphB is absolute
  // on top of it, so swapping between them never reflows anything.
  glyph: {
    textAlign: "center",
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  glyphOverlaid: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
}));
