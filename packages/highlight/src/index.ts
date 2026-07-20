export type { HighlightStyle, HighlightToken } from "./types.js";
export { getParserForFile, isLanguageSupported, getSupportedExtensions } from "./parsers.js";
export { getLanguageDisplayName } from "./language-names.js";
export { highlightCode, highlightLine } from "./highlighter.js";
export { detectLanguage } from "./detect.js";
export { extractSymbols } from "./symbols.js";
export type { CodeSymbol, SymbolKind } from "./symbols.js";
export { darkHighlightColors, lightHighlightColors } from "./colors.js";
export type { SyntaxThemeId, SyntaxThemeOption, SyntaxColors } from "./themes.js";
export {
  SYNTAX_THEME_IDS,
  SYNTAX_THEME_OPTIONS,
  isSyntaxThemeId,
  resolveSyntaxColors,
} from "./themes.js";
