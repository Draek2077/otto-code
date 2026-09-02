import { DEFAULT_MONO_FONT_STACK, DEFAULT_UI_FONT_STACK, FONT_SIZE } from "@/styles/theme";

/** Payload of the shell-level `otto-appearance` message (see the appearance
 * script in packages/visualizer/scripts/emit-bundle.mjs). */
export interface VisualizerAppearance {
  uiFontFamily: string;
  codeFontFamily: string;
  /** Chat prose size (resolved theme fontSize.sm) - the guest maps its own
   * 10px content ramp onto it (scale = chatFontSize / 10). */
  chatFontSize: number;
}

/**
 * Resolve the appearance settings into what the Visualizer guest needs,
 * mirroring `appearance/apply.ts`: empty families fall back to the default
 * stacks and chat prose renders at `fontSize.sm` (markdown-styles.ts body),
 * scaled from the authored ramp by `uiFontSize / FONT_SIZE.base`.
 */
export function resolveVisualizerAppearance(input: {
  uiFontFamily: string;
  monoFontFamily: string;
  uiFontSize: number;
  isCompact: boolean;
}): VisualizerAppearance {
  return {
    uiFontFamily: input.uiFontFamily.trim() || DEFAULT_UI_FONT_STACK,
    codeFontFamily: input.monoFontFamily.trim() || DEFAULT_MONO_FONT_STACK,
    chatFontSize: Math.round(FONT_SIZE.sm * (input.uiFontSize / FONT_SIZE.base)),
  };
}
