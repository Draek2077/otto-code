export type { DiffBackgroundColors, HighlightStyle, HighlightToken } from "./types.js";
export {
  getLanguageForFile,
  getParserForFile,
  isLanguageSupported,
  getSupportedExtensions,
} from "./parsers.js";
export { createCodeMirrorHighlightStyle } from "./syntax-roles.js";
export { getLanguageDisplayName } from "./language-names.js";
export { highlightCode, highlightLine } from "./highlighter.js";
export { detectLanguage } from "./detect.js";
export { extractSymbols } from "./symbols.js";
export type { CodeSymbol, SymbolKind } from "./symbols.js";
export { extractMarkdownHeadings } from "./markdown-headings.js";
export type { MarkdownHeading } from "./markdown-headings.js";
export { darkHighlightColors, lightHighlightColors } from "./colors.js";
export type { SyntaxThemeId, SyntaxThemeOption, SyntaxColors } from "./themes.js";
export {
  SYNTAX_THEME_IDS,
  SYNTAX_THEME_OPTIONS,
  isSyntaxThemeId,
  resolveSyntaxColors,
} from "./themes.js";
