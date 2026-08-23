import { UnistylesRuntime } from "react-native-unistyles";
import { resolveSyntaxColors, type SyntaxThemeId } from "@otto-code/highlight";
import { resolveChatMaxWidth, type ChatWidth } from "@/constants/layout";
import {
  DEFAULT_UI_FONT_STACK,
  DEFAULT_MONO_FONT_STACK,
  FONT_SIZE,
  ICON_SIZE,
  REGISTERED_THEMES,
  type Theme,
} from "@/styles/theme";
import { syncBlackChatScopeVars } from "@/styles/black-chat-scope";
import { applyRootUiFont } from "./apply-root-font";

// Compact form factors (phones, narrow windows) bump the interface font size by a
// flat 2px before the ramp is scaled, and double every icon size token. Both are
// re-applied here (not baked into FONT_SIZE/ICON_SIZE) so the authored ramp stays the
// single source of truth and desktop is unaffected.
// Exported for resolveVisualizerAppearance, which mirrors this resolution for
// the Visualizer guest page (visualizer-appearance.ts).
export const COMPACT_UI_FONT_SIZE_BUMP = 2;
const COMPACT_ICON_SIZE_FACTOR = 2;
// Title-bar and header glyphs, whose surrounding row is fixed by the window chrome
// and cannot grow with them. See `ICON_SIZE`'s `chrome*` ladder.
const COMPACT_CHROME_ICON_SIZE_FACTOR = 1.5;

// Derive the registry keys from the one theme registry shared with Unistyles.
const ALL_THEME_KEYS = Object.keys(REGISTERED_THEMES) as (keyof typeof REGISTERED_THEMES)[];

// The UI font size at which the FONT_SIZE ramp is authored (1.0 scale factor).
const BASE_UI_REFERENCE = FONT_SIZE.base; // 16

export interface AppearanceInput {
  uiFontFamily: string; // "" -> default stack
  monoFontFamily: string; // "" -> default stack
  uiFontSize: number; // already clamped
  codeFontSize: number; // already clamped
  syntaxTheme: SyntaxThemeId;
  chatWidth: ChatWidth;
  // True on compact form factors (phones, narrow windows) - see `useIsCompactFormFactor`.
  isCompact: boolean;
}

/**
 * Build the font-size ramp from the canonical `FONT_SIZE` ramp, scaled
 * proportionally by `uiSize / 16` so the type hierarchy is preserved at non-default
 * sizes. Deriving from the authored ramp - NOT the live (possibly already-scaled)
 * theme - makes `applyAppearance` idempotent: repeated applies never compound, and a
 * code-size change (uiSize unchanged) leaves the UI ramp at its authored values.
 * `code` is set absolutely to `codeSize`, never scaled by the UI factor - a separate
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

/**
 * Every icon size token, scaled for a compact form factor.
 *
 * **This is the only place an icon is scaled for a phone.** A call site names a size
 * token and gets the right pixels for the form factor it is on; it never multiplies.
 * Scaling at the call site is what produced the drift this replaced, and it compounds:
 * a glyph sized through an already-scaled token and then doubled again lands at 4x.
 *
 * The `chrome*` ladder scales by 1.5 rather than 2. Those icons sit in title bars and
 * header buttons whose height is fixed by the window chrome around them, so doubling
 * overruns the bar instead of filling it.
 */
function scaleIconSize(isCompact: boolean): Theme["iconSize"] {
  const factor = isCompact ? COMPACT_ICON_SIZE_FACTOR : 1;
  const chromeFactor = isCompact ? COMPACT_CHROME_ICON_SIZE_FACTOR : 1;
  return {
    xs: ICON_SIZE.xs * factor,
    sm: ICON_SIZE.sm * factor,
    md: ICON_SIZE.md * factor,
    lg: ICON_SIZE.lg * factor,
    chromeSm: ICON_SIZE.chromeSm * chromeFactor,
    chromeMd: ICON_SIZE.chromeMd * chromeFactor,
    chromeLg: ICON_SIZE.chromeLg * chromeFactor,
  };
}

/**
 * Patch every registered Unistyles theme with the user's appearance choices.
 * All keys are patched because the active theme can change and adaptive mode
 * can flip light/dark - patching all keys keeps the active key always current and
 * makes ordering vs `setTheme`/`setAdaptiveThemes` irrelevant.
 *
 * The updater preserves the active theme wholesale (surfaces, accents,
 * terminal) and only patches the font ramp and syntax palette.
 * `updateTheme` replaces the stored theme rather than merging, so we spread
 * `...t` first.
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
  const activeTheme = UnistylesRuntime.themeName;
  // Unistyles web emits after each registry patch. Updating the mounted theme
  // first ensures subscribers receive its new numeric tokens in this render;
  // updating it last makes Pure black appear one committed value behind.
  const themeKeys = activeTheme
    ? [activeTheme, ...ALL_THEME_KEYS.filter((key) => key !== activeTheme)]
    : ALL_THEME_KEYS;

  for (const key of themeKeys) {
    // Spread `...t` first - `updateTheme` replaces the stored theme, it does not
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

  // Web: re-mirror the `black` theme's variables onto the chat-scope class
  // after patching fonts/sizes/syntax into it (no-op on native).
  syncBlackChatScopeVars();
}
