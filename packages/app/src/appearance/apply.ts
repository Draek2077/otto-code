import { UnistylesRuntime } from "react-native-unistyles";
import { resolveSyntaxColors, type SyntaxThemeId } from "@otto-code/highlight";
import {
  DEFAULT_MONO_FONT_STACK,
  DEFAULT_UI_FONT_STACK,
  FONT_SIZE,
  ICON_SIZE,
  ICON_SIZE_COMPACT,
  REGISTERED_THEMES,
  type Theme,
} from "@/styles/theme";
import { resolveChatMaxWidth, type ChatWidth } from "@/constants/layout";
import { applyRootUiFont } from "./apply-root-font";

const ALL_THEME_KEYS = Object.keys(REGISTERED_THEMES) as (keyof typeof REGISTERED_THEMES)[];
export const COMPACT_FONT_SIZE_BUMP = 2;

/** Resolves a configured font size for the current form factor. */
export function resolveCompactFontSize(size: number, isCompact: boolean): number {
  return size + (isCompact ? COMPACT_FONT_SIZE_BUMP : 0);
}

export interface AppearanceInput {
  uiFontFamily: string;
  monoFontFamily: string;
  uiFontSize: number;
  contentFontSize: number;
  codeFontSize: number;
  syntaxTheme: SyntaxThemeId;
  chatWidth: ChatWidth;
  isCompact: boolean;
}

function scaleFontSize(
  uiSize: number,
  contentSize: number,
  codeSize: number,
  isCompact: boolean,
): Theme["fontSize"] {
  const effectiveUiSize = resolveCompactFontSize(uiSize, isCompact);
  const scale = effectiveUiSize / FONT_SIZE.base;
  return {
    xs: Math.round(FONT_SIZE.xs * scale),
    sm: Math.round(FONT_SIZE.sm * scale),
    base: Math.round(FONT_SIZE.base * scale),
    content: resolveCompactFontSize(contentSize, isCompact),
    lg: Math.round(FONT_SIZE.lg * scale),
    xl: Math.round(FONT_SIZE.xl * scale),
    "2xl": Math.round(FONT_SIZE["2xl"] * scale),
    "3xl": Math.round(FONT_SIZE["3xl"] * scale),
    "4xl": Math.round(FONT_SIZE["4xl"] * scale),
    code: resolveCompactFontSize(codeSize, isCompact),
  };
}

/**
 * Icon size is a form-factor concern, not a call-site concern. A named token
 * resolves to the thumb-sized ladder on compact screens while explicit numeric
 * sizes remain intentionally fixed for artwork and other non-chrome graphics.
 */
function resolveIconSize(isCompact: boolean): Theme["iconSize"] {
  return isCompact ? ICON_SIZE_COMPACT : ICON_SIZE;
}

/**
 * Applies Paseo's persisted font and syntax controls to every runtime key.
 * Compact typography is resolved once here, so screen styles consume semantic
 * theme roles instead of carrying their own phone-only point adjustments.
 */
export function applyAppearance(input: AppearanceInput): void {
  const ui = input.uiFontFamily.trim() || DEFAULT_UI_FONT_STACK;
  const mono = input.monoFontFamily.trim() || DEFAULT_MONO_FONT_STACK;
  const iconSize = resolveIconSize(input.isCompact);
  const activeTheme = UnistylesRuntime.themeName;
  const themeKeys = activeTheme
    ? [activeTheme, ...ALL_THEME_KEYS.filter((key) => key !== activeTheme)]
    : ALL_THEME_KEYS;

  for (const key of themeKeys) {
    UnistylesRuntime.updateTheme(key, (theme) => {
      // Narrow before spreading: Unistyles stores a discriminated theme union.
      if (theme.colorScheme === "light") {
        return {
          ...theme,
          fontFamily: { ui, mono },
          fontSize: scaleFontSize(
            input.uiFontSize,
            input.contentFontSize,
            input.codeFontSize,
            input.isCompact,
          ),
          iconSize,
          lineHeight: {
            ...theme.lineHeight,
            diff: Math.round(resolveCompactFontSize(input.codeFontSize, input.isCompact) * 1.5),
          },
          layout: { ...theme.layout, chatMaxWidth: resolveChatMaxWidth(input.chatWidth) },
          colors: {
            ...theme.colors,
            syntax: resolveSyntaxColors(input.syntaxTheme, theme.colorScheme),
          },
        };
      }
      return {
        ...theme,
        fontFamily: { ui, mono },
        fontSize: scaleFontSize(
          input.uiFontSize,
          input.contentFontSize,
          input.codeFontSize,
          input.isCompact,
        ),
        iconSize,
        lineHeight: {
          ...theme.lineHeight,
          diff: Math.round(resolveCompactFontSize(input.codeFontSize, input.isCompact) * 1.5),
        },
        layout: { ...theme.layout, chatMaxWidth: resolveChatMaxWidth(input.chatWidth) },
        colors: {
          ...theme.colors,
          syntax: resolveSyntaxColors(input.syntaxTheme, theme.colorScheme),
        },
      };
    });
  }
  applyRootUiFont(ui);
}
