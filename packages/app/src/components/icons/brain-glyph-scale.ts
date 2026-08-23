import { createElement } from "react";
import { View } from "react-native";
import type { NumericIconComponent } from "@/components/icons/icon-size";

/**
 * How much larger the `network_intelligence` family draws than the box it is
 * given.
 *
 * The family inks only 712x640 of its 960 viewBox, so beside the Material icons
 * it shares a rail with - and beside the Claude and Codex marks, which bleed to
 * their edges - the brain read undersized everywhere it appeared.
 *
 * ## Why this overflows instead of cropping the viewBox
 *
 * The obvious fix is to zoom the viewBox, and that is exactly what the provider
 * mark does (`PROVIDER_BRAIN_VIEW_BOX`) because it only has to fit one glyph.
 * It does not generalise: the badge-carrying variants ink much wider than the
 * plain brain, so the largest zoom each one survives is
 *
 *   brain 1.348 · scan 1.277 · sweep/calibrate 1.200 · error 1.116 · benchmark/download 1.091
 *
 * A uniform viewBox zoom is therefore capped at 1.09 - invisible - and a
 * per-glyph zoom would make the rail's status light change size as its state
 * changed, which is the one thing a status light must not do. Drawing over the
 * box costs a `overflow: visible` and scales every glyph by the same factor.
 *
 * The marks that sit in the gap (`BrainCalibrate`, `BrainSweep`) are deliberately
 * NOT scaled: their size is derived from the brain they sit in, so they follow it
 * already and scaling them here would apply the factor twice.
 */
export const BRAIN_GLYPH_SCALE = 1.1;

/** The drawn size for a brain glyph laid out in a `size` box. */
export function brainGlyphExtent(size: number): number {
  return size * BRAIN_GLYPH_SCALE;
}

/** How far the drawn glyph hangs outside its box on each edge. */
export function brainGlyphInset(size: number): number {
  return (size - brainGlyphExtent(size)) / 2;
}

/**
 * Lay a brain glyph out at `size`, draw it at {@link BRAIN_GLYPH_SCALE} times
 * that, centred on the box it overflows.
 *
 * Laying out at the requested size is the point: every caller sits in a row or a
 * grid with other icons, and growing the box would shove that layout around
 * rather than just making the mark read.
 */
export function withBrainGlyphScale(
  Icon: NumericIconComponent,
  name: string,
): NumericIconComponent {
  const ScaledBrainIcon: NumericIconComponent = ({ size, color, style }) =>
    createElement(
      View,
      {
        // react-native-web's View defaults to `overflow: hidden`, which would
        // crop the part that hangs outside. Native defaults to visible.
        style: [{ width: size, height: size, overflow: "visible" as const }, style],
      },
      createElement(
        View,
        {
          style: {
            position: "absolute" as const,
            left: brainGlyphInset(size),
            top: brainGlyphInset(size),
          },
        },
        createElement(Icon, { size: brainGlyphExtent(size), color }),
      ),
    );
  ScaledBrainIcon.displayName = `ScaledBrainIcon(${name})`;
  return ScaledBrainIcon;
}
