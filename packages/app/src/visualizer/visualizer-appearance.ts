import { COMPACT_UI_FONT_SIZE_BUMP } from "@/screens/settings/appearance/apply-appearance";
import { DEFAULT_MONO_FONT_STACK, DEFAULT_UI_FONT_STACK, FONT_SIZE } from "@/styles/theme";

/** Payload of the shell-level `otto-appearance` message (see the appearance
 * script in packages/visualizer/scripts/emit-bundle.mjs). */
export interface VisualizerAppearance {
  uiFontFamily: string;
  codeFontFamily: string;
  /** Chat prose size (resolved theme fontSize.sm) — the guest maps its own
   * 10px content ramp onto it (scale = chatFontSize / 10). */
  chatFontSize: number;
}

/**
 * Resolve the appearance settings into what the Visualizer guest needs,
 * mirroring `applyAppearance` (apply-appearance.ts): empty families fall back
 * to the default stacks, compact form factors bump the UI size before the
 * ramp scales, and chat prose renders at `fontSize.sm` (markdown-styles.ts
 * body) — scaled from the authored ramp by `uiFontSize / FONT_SIZE.base`.
 */
export function resolveVisualizerAppearance(input: {
  uiFontFamily: string;
  monoFontFamily: string;
  uiFontSize: number;
  isCompact: boolean;
}): VisualizerAppearance {
  const effectiveUiFontSize = input.isCompact
    ? input.uiFontSize + COMPACT_UI_FONT_SIZE_BUMP
    : input.uiFontSize;
  return {
    uiFontFamily: input.uiFontFamily.trim() || DEFAULT_UI_FONT_STACK,
    codeFontFamily: input.monoFontFamily.trim() || DEFAULT_MONO_FONT_STACK,
    chatFontSize: Math.round(FONT_SIZE.sm * (effectiveUiFontSize / FONT_SIZE.base)),
  };
}
