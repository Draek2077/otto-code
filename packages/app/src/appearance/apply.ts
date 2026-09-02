import { UnistylesRuntime } from "react-native-unistyles";
import { resolveSyntaxColors, type SyntaxThemeId } from "@otto-code/highlight";
import {
  DEFAULT_MONO_FONT_STACK,
  DEFAULT_UI_FONT_STACK,
  FONT_SIZE,
  REGISTERED_THEMES,
  type Theme,
} from "@/styles/theme";
import { resolveChatMaxWidth, type ChatWidth } from "@/constants/layout";
import { applyRootUiFont } from "./apply-root-font";

const ALL_THEME_KEYS = Object.keys(REGISTERED_THEMES) as (keyof typeof REGISTERED_THEMES)[];

export interface AppearanceInput {
  uiFontFamily: string;
  monoFontFamily: string;
  uiFontSize: number;
  contentFontSize: number;
  codeFontSize: number;
  syntaxTheme: SyntaxThemeId;
  chatWidth: ChatWidth;
}

function scaleFontSize(uiSize: number, contentSize: number, codeSize: number): Theme["fontSize"] {
  const scale = uiSize / FONT_SIZE.base;
  return {
    xs: Math.round(FONT_SIZE.xs * scale),
    sm: Math.round(FONT_SIZE.sm * scale),
    base: Math.round(FONT_SIZE.base * scale),
    content: contentSize,
    lg: Math.round(FONT_SIZE.lg * scale),
    xl: Math.round(FONT_SIZE.xl * scale),
    "2xl": Math.round(FONT_SIZE["2xl"] * scale),
    "3xl": Math.round(FONT_SIZE["3xl"] * scale),
    "4xl": Math.round(FONT_SIZE["4xl"] * scale),
    code: codeSize,
  };
}

/** Applies Paseo's persisted font and syntax controls to every runtime key. */
export function applyAppearance(input: AppearanceInput): void {
  const ui = input.uiFontFamily.trim() || DEFAULT_UI_FONT_STACK;
  const mono = input.monoFontFamily.trim() || DEFAULT_MONO_FONT_STACK;
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
          fontSize: scaleFontSize(input.uiFontSize, input.contentFontSize, input.codeFontSize),
          lineHeight: { ...theme.lineHeight, diff: Math.round(input.codeFontSize * 1.5) },
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
        fontSize: scaleFontSize(input.uiFontSize, input.contentFontSize, input.codeFontSize),
        lineHeight: { ...theme.lineHeight, diff: Math.round(input.codeFontSize * 1.5) },
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
