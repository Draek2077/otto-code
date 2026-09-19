import { FONT_SIZE, type Theme } from "./theme";
import { isWeb } from "@/constants/platform";
import { themeColorRef } from "./theme-color-ref";

const webSelectableTextStyle = isWeb ? { userSelect: "text" as const } : {};

/**
 * Creates comprehensive markdown styles for react-native-markdown-display.
 *
 * Colors go through `themeColorRef`, NOT `theme.colors.*` directly: these
 * styles are resolved in JS (withUnistyles `uniProps` in markdown/renderer)
 * and on web a concrete hex would ignore scoped-theme wrappers like the black
 * chat scope - light-theme text on the pure-black chat pane. See
 * `styles/theme-color-ref.ts`.
 *
 * Vertical rhythm: React Native (Yoga) does NOT collapse adjacent margins the
 * way browsers do - a block's marginBottom and the next block's marginTop
 * always stack. Blocks therefore own their spacing via marginBottom, and top
 * margins stay small: they are the *extra* gap added on top of whatever the
 * previous block already left. Sizing a marginTop as if it were the whole gap
 * (browser instinct) doubles the whitespace at every `---` + heading boundary.
 *
 * Usage:
 *   const markdownStyles = useMemo(() => createMarkdownStyles(theme), [theme]);
 *   <Markdown style={markdownStyles} markdownit={parser}>{content}</Markdown>
 *
 * Always pass `markdownit` from `@/utils/markdown-parser`. Omit it and
 * react-native-markdown-display builds its own parser with `typographer: true`,
 * which rewrites a literal `(c)` as ©.
 */
export function createMarkdownStyles(theme: Theme) {
  return createMarkdownStylesForSize(theme, theme.fontSize.content, theme.fontSize.content);
}

function createMarkdownStylesForSize(theme: Theme, proseSize: number, headingSize: number) {
  // Keep Otto's heading tiers and rhythm while following the selected prose
  // owner. Compact summaries supply UI sizes; ordinary Markdown supplies content.
  const headingMetric = (size: number) => Math.round((size * headingSize) / FONT_SIZE.base);
  const proseLineHeight = Math.round(proseSize * 1.4);
  return {
    // =========================================================================
    // BASE STYLES
    // =========================================================================

    body: {
      ...webSelectableTextStyle,
      color: themeColorRef(theme, "foreground"),
      fontSize: proseSize,
      lineHeight: proseLineHeight,
      flexShrink: 1,
      minWidth: 0,
      // In a content-sized native bubble, nested percentage widths can be
      // resolved during measurement and stay stale after the bubble grows.
      // Let Yoga stretch the body to the bubble's final content width.
      width: isWeb ? ("100%" as const) : ("auto" as const),
    },

    text: {
      ...webSelectableTextStyle,
      color: themeColorRef(theme, "foreground"),
      fontSize: proseSize,
      lineHeight: proseLineHeight,
      flexShrink: 1,
      minWidth: 0,
      overflowWrap: "anywhere" as const,
    },

    paragraph: {
      marginTop: 0,
      marginBottom: theme.spacing[3],
      flexWrap: "wrap" as const,
      flexDirection: "row" as const,
      alignItems: "flex-start" as const,
      justifyContent: "flex-start" as const,
      flexShrink: 1,
      minWidth: 0,
      width: "100%" as const,
    },

    // =========================================================================
    // HEADINGS
    // =========================================================================

    // No underline borders on headings: models separate sections with `---`
    // anyway, and an hr plus an underlined heading renders as two stacked
    // lines that read as a glitch.
    heading1: {
      ...webSelectableTextStyle,
      fontSize: headingMetric(FONT_SIZE["3xl"]),
      fontWeight: theme.fontWeight.bold,
      color: themeColorRef(theme, "foreground"),
      marginTop: theme.spacing[3],
      marginBottom: theme.spacing[3],
      lineHeight: headingMetric(32),
    },

    heading2: {
      ...webSelectableTextStyle,
      fontSize: headingMetric(FONT_SIZE["2xl"]),
      fontWeight: theme.fontWeight.bold,
      color: themeColorRef(theme, "foreground"),
      marginTop: theme.spacing[3],
      marginBottom: theme.spacing[3],
      lineHeight: headingMetric(28),
    },

    heading3: {
      ...webSelectableTextStyle,
      fontSize: headingMetric(FONT_SIZE.xl),
      fontWeight: theme.fontWeight.semibold,
      color: themeColorRef(theme, "foreground"),
      marginTop: theme.spacing[3],
      marginBottom: theme.spacing[2],
      lineHeight: headingMetric(26),
    },

    heading4: {
      ...webSelectableTextStyle,
      fontSize: headingMetric(FONT_SIZE.lg),
      fontWeight: theme.fontWeight.semibold,
      color: themeColorRef(theme, "foreground"),
      marginTop: theme.spacing[3],
      marginBottom: theme.spacing[2],
      lineHeight: headingMetric(24),
    },

    heading5: {
      ...webSelectableTextStyle,
      fontSize: headingMetric(FONT_SIZE.base),
      fontWeight: theme.fontWeight.semibold,
      color: themeColorRef(theme, "foreground"),
      marginTop: theme.spacing[2],
      marginBottom: theme.spacing[1],
      lineHeight: headingMetric(22),
    },

    heading6: {
      ...webSelectableTextStyle,
      fontSize: headingMetric(FONT_SIZE.base),
      fontWeight: theme.fontWeight.semibold,
      color: themeColorRef(theme, "foregroundMuted"),
      marginTop: theme.spacing[2],
      marginBottom: theme.spacing[1],
      lineHeight: headingMetric(20),
      textTransform: "uppercase" as const,
      letterSpacing: 0.5,
    },

    // =========================================================================
    // TEXT FORMATTING
    // =========================================================================

    strong: {
      ...webSelectableTextStyle,
      fontWeight: theme.fontWeight.medium,
    },

    em: {
      ...webSelectableTextStyle,
      fontStyle: "italic" as const,
    },

    s: {
      ...webSelectableTextStyle,
      textDecorationLine: "line-through" as const,
      color: themeColorRef(theme, "foregroundMuted"),
    },

    link: {
      ...webSelectableTextStyle,
      color: themeColorRef(theme, "accentBright"),
      textDecorationLine: "none" as const,
      flexShrink: 1,
      minWidth: 0,
      overflowWrap: "anywhere" as const,
    },

    blocklink: {
      ...webSelectableTextStyle,
      color: themeColorRef(theme, "accentBright"),
      textDecorationLine: "none" as const,
      flexShrink: 1,
      minWidth: 0,
      overflowWrap: "anywhere" as const,
    },

    // =========================================================================
    // CODE
    // =========================================================================

    code_inline: {
      ...webSelectableTextStyle,
      // surface3, not surface2: assistant prose renders inside a surface2
      // bubble (see assistantMessageStylesheet.bubble), where a surface2 chip
      // would vanish into the bubble background.
      backgroundColor: themeColorRef(theme, "surface3"),
      color: themeColorRef(theme, "foreground"),
      paddingHorizontal: theme.spacing[1],
      paddingVertical: 2,
      borderRadius: theme.borderRadius.md,
      borderWidth: 0,
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
    },

    // Indented and fenced blocks both sit on `surfaceCode` - the editor's code
    // well, not the elevated-card ramp. Code quoted in chat is the same
    // material as the same code open in the editor.
    code_block: {
      ...webSelectableTextStyle,
      backgroundColor: themeColorRef(theme, "surfaceCode"),
      color: themeColorRef(theme, "foreground"),
      padding: theme.spacing[3],
      borderRadius: theme.borderRadius.md,
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
      marginVertical: theme.spacing[2],
    },

    fence: {
      ...webSelectableTextStyle,
      backgroundColor: themeColorRef(theme, "surfaceCode"),
      color: themeColorRef(theme, "foreground"),
      padding: theme.spacing[3],
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      borderColor: themeColorRef(theme, "border"),
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
      marginVertical: theme.spacing[3],
    },

    pre: {
      marginVertical: theme.spacing[2],
    },

    // =========================================================================
    // TABLES
    // =========================================================================

    table: {
      borderWidth: 1,
      borderColor: themeColorRef(theme, "border"),
      borderRadius: theme.borderRadius.md,
      // The outer shell owns the rounded edge. Clip rectangular header/cell
      // backgrounds to it so the corner geometry stays coherent in every
      // theme.
      overflow: "hidden" as const,
      marginVertical: theme.spacing[3],
    },

    thead: {
      backgroundColor: themeColorRef(theme, "surface2"),
    },

    tbody: {},

    th: {
      ...webSelectableTextStyle,
      padding: theme.spacing[2],
      borderRightWidth: 1,
      borderColor: themeColorRef(theme, "border"),
      backgroundColor: themeColorRef(theme, "surface2"),
      fontWeight: theme.fontWeight.semibold,
      color: themeColorRef(theme, "foreground"),
      fontSize: proseSize,
      textAlign: "left" as const,
    },

    tr: {
      borderBottomWidth: 1,
      borderColor: themeColorRef(theme, "border"),
      flexDirection: "row" as const,
    },

    td: {
      ...webSelectableTextStyle,
      padding: theme.spacing[2],
      borderRightWidth: 1,
      borderColor: themeColorRef(theme, "border"),
      color: themeColorRef(theme, "foreground"),
      fontSize: proseSize,
      flex: 1,
    },

    // The table shell owns its outside border. These positional variants are
    // applied by the renderer so the final row/cell cannot draw a second line
    // against the shell's bottom/right edges.
    tableLastRow: {
      borderBottomWidth: 0,
    },

    tableLastCell: {
      borderRightWidth: 0,
    },

    // =========================================================================
    // LISTS
    // =========================================================================

    bullet_list: {
      paddingLeft: 0,
      width: "100%" as const,
    },

    ordered_list: {
      paddingLeft: 0,
      width: "100%" as const,
    },

    list_item: {
      marginBottom: theme.spacing[1],
      flexDirection: "row" as const,
      alignItems: "flex-start" as const,
      flexShrink: 1,
    },

    bullet_list_content: {
      // Native flex: 1 gives this column a zero basis during intrinsic
      // measurement, so a list-only bubble can size itself to just the marker.
      // Reset the library's flex shorthand and let the text establish its width.
      flex: isWeb ? 1 : 0,
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 0,
    },

    ordered_list_content: {
      flex: isWeb ? 1 : 0,
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 0,
    },

    bullet_list_icon: {
      ...webSelectableTextStyle,
      color: themeColorRef(theme, "foregroundMuted"),
      marginRight: 4,
      fontSize: proseSize,
      lineHeight: proseLineHeight,
    },

    ordered_list_icon: {
      ...webSelectableTextStyle,
      color: themeColorRef(theme, "foregroundMuted"),
      marginRight: 4,
      fontSize: proseSize,
      fontWeight: theme.fontWeight.normal,
      lineHeight: proseLineHeight,
      minWidth: 12,
    },

    // =========================================================================
    // BLOCKQUOTE
    // =========================================================================

    blockquote: {
      backgroundColor: themeColorRef(theme, "surface2"),
      borderLeftWidth: 4,
      borderLeftColor: themeColorRef(theme, "primary"),
      paddingHorizontal: theme.spacing[4],
      paddingVertical: theme.spacing[3],
      marginVertical: theme.spacing[3],
      borderRadius: theme.borderRadius.md,
    },

    // =========================================================================
    // GITHUB ALERTS
    // =========================================================================
    // Only the accent varies per kind; the surface stays the ordinary
    // blockquote's, so an alert reads as a blockquote that is telling you
    // something rather than as a different kind of box. Colour assignment
    // follows GitHub's own.
    alertNote: { borderLeftColor: themeColorRef(theme, "statusInfo") },
    alertTip: { borderLeftColor: themeColorRef(theme, "statusSuccess") },
    alertImportant: { borderLeftColor: themeColorRef(theme, "primary") },
    alertWarning: { borderLeftColor: themeColorRef(theme, "statusWarning") },
    alertCaution: { borderLeftColor: themeColorRef(theme, "destructive") },
    alertTitle: {
      fontSize: proseSize,
      fontWeight: "600",
      marginBottom: theme.spacing[1],
    },
    alertTitleNote: { color: themeColorRef(theme, "statusInfo") },
    alertTitleTip: { color: themeColorRef(theme, "statusSuccess") },
    alertTitleImportant: { color: themeColorRef(theme, "primary") },
    alertTitleWarning: { color: themeColorRef(theme, "statusWarning") },
    alertTitleCaution: { color: themeColorRef(theme, "destructive") },

    // =========================================================================
    // HORIZONTAL RULE
    // =========================================================================

    // Models often emit `---` directly before a heading; both hr margins plus
    // the heading's marginTop land in that one gap (no collapsing), so hr
    // spacing must stay modest for the combined section break to look sane.
    hr: {
      backgroundColor: themeColorRef(theme, "border"),
      height: 1,
      marginVertical: theme.spacing[2],
    },

    // =========================================================================
    // IMAGES
    // =========================================================================

    image: {
      borderRadius: theme.borderRadius.md,
      marginVertical: theme.spacing[2],
    },

    // =========================================================================
    // BREAKS
    // =========================================================================

    hardbreak: {
      height: theme.spacing[2],
    },

    softbreak: {},
  };
}

/**
 * Creates a smaller variant of markdown styles for compact UI elements
 * like thought bubbles, tooltips, or side panels.
 */
export function createCompactMarkdownStyles(theme: Theme) {
  // Resolve all text leaves, list markers, tables and lower headings from the
  // UI owner together. Overriding only body lets nested text retain content size.
  const baseStyles = createMarkdownStylesForSize(theme, theme.fontSize.sm, theme.fontSize.base);
  const headingLineHeight = (size: number) =>
    Math.round((size * theme.fontSize.base) / FONT_SIZE.base);

  return {
    ...baseStyles,

    heading1: {
      ...baseStyles.heading1,
      fontSize: theme.fontSize.xl,
      marginTop: theme.spacing[3],
      marginBottom: theme.spacing[2],
      lineHeight: headingLineHeight(26),
    },

    heading2: {
      ...baseStyles.heading2,
      fontSize: theme.fontSize.lg,
      marginTop: theme.spacing[3],
      marginBottom: theme.spacing[2],
      lineHeight: headingLineHeight(24),
    },

    heading3: {
      ...baseStyles.heading3,
      fontSize: theme.fontSize.base,
      marginTop: theme.spacing[2],
      marginBottom: theme.spacing[1],
      lineHeight: headingLineHeight(22),
    },

    paragraph: {
      ...baseStyles.paragraph,
      marginBottom: theme.spacing[2],
    },

    code_inline: {
      ...baseStyles.code_inline,
      fontSize: theme.fontSize.code,
    },

    code_block: {
      ...baseStyles.code_block,
      fontSize: theme.fontSize.code,
      padding: theme.spacing[2],
    },

    fence: {
      ...baseStyles.fence,
      fontSize: theme.fontSize.code,
      padding: theme.spacing[2],
    },
  };
}
