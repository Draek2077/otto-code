import type { Theme } from "./theme";
import { isWeb } from "@/constants/platform";
import { themeColorRef } from "./theme-color-ref";

const webSelectableTextStyle = isWeb ? { userSelect: "text" as const } : {};

/**
 * Creates comprehensive markdown styles for react-native-markdown-display.
 *
 * Colors go through `themeColorRef`, NOT `theme.colors.*` directly: these
 * styles are resolved in JS (withUnistyles `uniProps` in markdown/renderer)
 * and on web a concrete hex would ignore scoped-theme wrappers like the black
 * chat scope — light-theme text on the pure-black chat pane. See
 * `styles/theme-color-ref.ts`.
 *
 * Usage:
 *   const markdownStyles = useMemo(() => createMarkdownStyles(theme), [theme]);
 *   <Markdown style={markdownStyles}>{content}</Markdown>
 */
export function createMarkdownStyles(theme: Theme) {
  return {
    // =========================================================================
    // BASE STYLES
    // =========================================================================

    body: {
      ...webSelectableTextStyle,
      color: themeColorRef(theme, "foreground"),
      // Prose matches the UI's own text size (sidebar rows, tab titles), not
      // fontSize.base — chat is a working surface, not a document.
      fontSize: theme.fontSize.sm,
      lineHeight: Math.round(theme.fontSize.sm * 1.4),
      flexShrink: 1,
      minWidth: 0,
      width: "100%" as const,
    },

    text: {
      ...webSelectableTextStyle,
      color: themeColorRef(theme, "foreground"),
      fontSize: theme.fontSize.sm,
      lineHeight: Math.round(theme.fontSize.sm * 1.4),
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

    heading1: {
      ...webSelectableTextStyle,
      fontSize: theme.fontSize["3xl"],
      fontWeight: theme.fontWeight.bold,
      color: themeColorRef(theme, "foreground"),
      marginTop: theme.spacing[6],
      marginBottom: theme.spacing[3],
      lineHeight: 32,
      borderBottomWidth: 1,
      borderBottomColor: themeColorRef(theme, "border"),
      paddingBottom: theme.spacing[2],
    },

    heading2: {
      ...webSelectableTextStyle,
      fontSize: theme.fontSize["2xl"],
      fontWeight: theme.fontWeight.bold,
      color: themeColorRef(theme, "foreground"),
      marginTop: theme.spacing[6],
      marginBottom: theme.spacing[3],
      lineHeight: 28,
      borderBottomWidth: 1,
      borderBottomColor: themeColorRef(theme, "border"),
      paddingBottom: theme.spacing[2],
    },

    heading3: {
      ...webSelectableTextStyle,
      fontSize: theme.fontSize.xl,
      fontWeight: theme.fontWeight.semibold,
      color: themeColorRef(theme, "foreground"),
      marginTop: theme.spacing[4],
      marginBottom: theme.spacing[2],
      lineHeight: 26,
    },

    heading4: {
      ...webSelectableTextStyle,
      fontSize: theme.fontSize.lg,
      fontWeight: theme.fontWeight.semibold,
      color: themeColorRef(theme, "foreground"),
      marginTop: theme.spacing[4],
      marginBottom: theme.spacing[2],
      lineHeight: 24,
    },

    heading5: {
      ...webSelectableTextStyle,
      fontSize: theme.fontSize.base,
      fontWeight: theme.fontWeight.semibold,
      color: themeColorRef(theme, "foreground"),
      marginTop: theme.spacing[3],
      marginBottom: theme.spacing[1],
      lineHeight: 22,
    },

    heading6: {
      ...webSelectableTextStyle,
      fontSize: theme.fontSize.base,
      fontWeight: theme.fontWeight.semibold,
      color: themeColorRef(theme, "foregroundMuted"),
      marginTop: theme.spacing[3],
      marginBottom: theme.spacing[1],
      lineHeight: 20,
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
      backgroundColor: themeColorRef(theme, "surface2"),
      color: themeColorRef(theme, "foreground"),
      paddingHorizontal: theme.spacing[1],
      paddingVertical: 2,
      borderRadius: theme.borderRadius.md,
      borderWidth: 0,
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
      lineHeight: Math.round(theme.fontSize.code * 1.45),
    },

    code_block: {
      ...webSelectableTextStyle,
      backgroundColor: themeColorRef(theme, "surface2"),
      color: themeColorRef(theme, "foreground"),
      padding: theme.spacing[3],
      borderRadius: theme.borderRadius.md,
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
      marginVertical: theme.spacing[2],
    },

    fence: {
      ...webSelectableTextStyle,
      backgroundColor: themeColorRef(theme, "surface2"),
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
      marginVertical: theme.spacing[3],
    },

    thead: {
      backgroundColor: themeColorRef(theme, "surface2"),
    },

    tbody: {},

    th: {
      ...webSelectableTextStyle,
      padding: theme.spacing[2],
      borderBottomWidth: 1,
      borderRightWidth: 1,
      borderColor: themeColorRef(theme, "border"),
      backgroundColor: themeColorRef(theme, "surface2"),
      fontWeight: theme.fontWeight.semibold,
      color: themeColorRef(theme, "foreground"),
      fontSize: theme.fontSize.sm,
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
      fontSize: theme.fontSize.sm,
      flex: 1,
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
      flex: 1,
      flexShrink: 1,
    },

    ordered_list_content: {
      flex: 1,
      flexShrink: 1,
    },

    bullet_list_icon: {
      ...webSelectableTextStyle,
      color: themeColorRef(theme, "foregroundMuted"),
      marginRight: 4,
      fontSize: theme.fontSize.sm,
      lineHeight: 20,
    },

    ordered_list_icon: {
      ...webSelectableTextStyle,
      color: themeColorRef(theme, "foregroundMuted"),
      marginRight: 4,
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.normal,
      lineHeight: 20,
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
    // HORIZONTAL RULE
    // =========================================================================

    hr: {
      backgroundColor: themeColorRef(theme, "border"),
      height: 1,
      marginVertical: theme.spacing[6],
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
  const baseStyles = createMarkdownStyles(theme);

  return {
    ...baseStyles,

    body: {
      ...baseStyles.body,
      fontSize: theme.fontSize.sm,
      lineHeight: 20,
    },

    heading1: {
      ...baseStyles.heading1,
      fontSize: theme.fontSize.xl,
      marginTop: theme.spacing[4],
      marginBottom: theme.spacing[2],
      lineHeight: 26,
    },

    heading2: {
      ...baseStyles.heading2,
      fontSize: theme.fontSize.lg,
      marginTop: theme.spacing[3],
      marginBottom: theme.spacing[2],
      lineHeight: 24,
    },

    heading3: {
      ...baseStyles.heading3,
      fontSize: theme.fontSize.base,
      marginTop: theme.spacing[3],
      marginBottom: theme.spacing[1],
      lineHeight: 22,
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
