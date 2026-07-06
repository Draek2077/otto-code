import { UnistylesRuntime } from "react-native-unistyles";
import { resolveSyntaxColors, type SyntaxThemeId } from "@otto-code/highlight";
import { resolveChatMaxWidth, type ChatWidth } from "@/constants/layout";
import {
  DEFAULT_UI_FONT_STACK,
  DEFAULT_MONO_FONT_STACK,
  FONT_SIZE,
  ICON_SIZE,
  type Theme,
} from "@/styles/theme";
import { applyRootUiFont } from "./apply-root-font";

// Compact form factors (phones, narrow windows) bump the interface font size by a
// flat 2px before the ramp is scaled, and double every icon size token. Both are
// re-applied here (not baked into FONT_SIZE/ICON_SIZE) so the authored ramp stays the
// single source of truth and desktop is unaffected.
const COMPACT_UI_FONT_SIZE_BUMP = 2;
const COMPACT_ICON_SIZE_FACTOR = 2;

// All registered Unistyles keys — pinned literal (greppable, type-checked).
// The `as const` element types are exactly `keyof UnistylesThemes`, so each key
// is assignable to `UnistylesRuntime.updateTheme`'s first argument with no cast.
// Only these keys are ever registered (see `styles/unistyles.ts`); every named
// theme variant is repainted into `light`/`dark` by `apply-color-scheme.ts`,
// not registered under its own key. `black` is the scoped-only chat mirror
// used by the Black tab background setting.
const ALL_THEME_KEYS = ["light", "dark", "black"] as const;

// The UI font size at which the FONT_SIZE ramp is authored (1.0 scale factor).
const BASE_UI_REFERENCE = FONT_SIZE.base; // 16

export interface AppearanceInput {
  uiFontFamily: string; // "" -> default stack
  monoFontFamily: string; // "" -> default stack
  uiFontSize: number; // already clamped
  codeFontSize: number; // already clamped
  syntaxTheme: SyntaxThemeId;
  chatWidth: ChatWidth;
  // True on compact form factors (phones, narrow windows) — see `useIsCompactFormFactor`.
  isCompact: boolean;
}

/**
 * Build the font-size ramp from the canonical `FONT_SIZE` ramp, scaled
 * proportionally by `uiSize / 16` so the type hierarchy is preserved at non-default
 * sizes. Deriving from the authored ramp — NOT the live (possibly already-scaled)
 * theme — makes `applyAppearance` idempotent: repeated applies never compound, and a
 * code-size change (uiSize unchanged) leaves the UI ramp at its authored values.
 * `code` is set absolutely to `codeSize`, never scaled by the UI factor — a separate
 * control on a separate semantic axis (mono/diff text).
 */
function scaleFontSize(uiSize: number, codeSize: number): Theme["fontSize"] {
  const r = uiSize / BASE_UI_REFERENCE;
  return {
    xs: Math.round(FONT_SIZE.xs * r),
    sm: Math.round(FONT_SIZE.sm * r),
    base: Math.round(FONT_SIZE.base * r),
    lg: Math.round(FONT_SIZE.lg * r),
    xl: Math.round(FONT_SIZE.xl * r),
    "2xl": Math.round(FONT_SIZE["2xl"] * r),
    "3xl": Math.round(FONT_SIZE["3xl"] * r),
    "4xl": Math.round(FONT_SIZE["4xl"] * r),
    code: codeSize, // absolute, NOT scaled
  };
}

/** Every icon size token, doubled when on a compact form factor. */
function scaleIconSize(isCompact: boolean): Theme["iconSize"] {
  const factor = isCompact ? COMPACT_ICON_SIZE_FACTOR : 1;
  return {
    xs: ICON_SIZE.xs * factor,
    sm: ICON_SIZE.sm * factor,
    md: ICON_SIZE.md * factor,
    lg: ICON_SIZE.lg * factor,
  };
}

/**
 * Patch every registered Unistyles theme with the user's appearance choices.
 * All keys are patched because the active theme can change and adaptive mode
 * can flip light/dark — patching all keys keeps the active key always current and
 * makes ordering vs `setTheme`/`setAdaptiveThemes` irrelevant.
 */
export function applyAppearance(input: AppearanceInput): void {
  const ui = input.uiFontFamily.trim() || DEFAULT_UI_FONT_STACK;
  const mono = input.monoFontFamily.trim() || DEFAULT_MONO_FONT_STACK;
  const layout = { chatMaxWidth: resolveChatMaxWidth(input.chatWidth) };
  const effectiveUiFontSize = input.isCompact
    ? input.uiFontSize + COMPACT_UI_FONT_SIZE_BUMP
    : input.uiFontSize;
  const effectiveCodeFontSize = input.isCompact
    ? input.codeFontSize + COMPACT_UI_FONT_SIZE_BUMP
    : input.codeFontSize;
  const diffLineHeight = Math.round(effectiveCodeFontSize * 1.5); // couple to code size
  const iconSize = scaleIconSize(input.isCompact);

  for (const key of ALL_THEME_KEYS) {
    // Spread `...t` first — `updateTheme` replaces the stored theme, it does not
    // merge; an omitted key would be dropped. `syntax` follows the theme's own
    // scheme for `auto`; named palettes ignore it. `colors.base`/plain text stays
    // `theme.colors.foreground` (owned by `syntaxTokenStyles.base`, not patched).
    //
    // Narrow on the `colorScheme` discriminant before spreading: the updater must
    // return the theme union, and a spread of the union widens `colorScheme` to
    // `"light" | "dark"`, assignable to neither concrete member. Each branch spreads
    // a single narrowed theme type.
    UnistylesRuntime.updateTheme(key, (t) => {
      const fontFamily = { ui, mono };
      const fontSize = scaleFontSize(effectiveUiFontSize, effectiveCodeFontSize);
      const lineHeight = { ...t.lineHeight, diff: diffLineHeight };
      if (t.colorScheme === "light") {
        return {
          ...t,
          fontFamily,
          fontSize,
          iconSize,
          lineHeight,
          layout,
          colors: { ...t.colors, syntax: resolveSyntaxColors(input.syntaxTheme, t.colorScheme) },
        };
      }
      return {
        ...t,
        fontFamily,
        fontSize,
        iconSize,
        lineHeight,
        layout,
        colors: { ...t.colors, syntax: resolveSyntaxColors(input.syntaxTheme, t.colorScheme) },
      };
    });
  }

  // Web: apply the UI font app-wide (RN-web stamps a default font on every text
  // element, so it can't be done through the theme alone). No-op on native.
  applyRootUiFont(ui);
}
