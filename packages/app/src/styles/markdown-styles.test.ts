import { describe, expect, it } from "vitest";
import { createCompactMarkdownStyles, createMarkdownStyles } from "./markdown-styles";
import { darkTheme } from "./theme";

describe("createMarkdownStyles", () => {
  it("uses independent content size for conversation prose, tables and list markers", () => {
    const theme = {
      ...darkTheme,
      fontSize: { ...darkTheme.fontSize, sm: 12, base: 14, content: 21, code: 15 },
    };
    const styles = createMarkdownStyles(theme);
    const proseLineHeight = Math.round(21 * 1.4);

    expect(styles.body).toMatchObject({
      fontSize: 21,
      lineHeight: proseLineHeight,
    });
    expect(styles.text).toMatchObject({
      fontSize: 21,
      lineHeight: proseLineHeight,
    });
    expect(styles.bullet_list_icon).toMatchObject({
      fontSize: 21,
      lineHeight: proseLineHeight,
    });
    expect(styles.ordered_list_icon).toMatchObject({
      fontSize: 21,
      lineHeight: proseLineHeight,
    });
    expect(styles.th.fontSize).toBe(21);
    expect(styles.td.fontSize).toBe(21);
    expect(styles.alertTitle.fontSize).toBe(21);
    expect(styles.code_inline.fontSize).toBe(15);
    expect(styles.code_block.fontSize).toBe(15);
    expect(styles.fence.fontSize).toBe(15);
    expect(
      createMarkdownStyles({
        ...theme,
        fontSize: { ...theme.fontSize, sm: 20, base: 22, xl: 28, code: 18 },
      }).body,
    ).toEqual(styles.body);
  });

  it("applies shrink-and-wrap constraints to long markdown text and links", () => {
    const styles = createMarkdownStyles(darkTheme);

    expect(styles.body).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      width: "100%",
    });

    expect(styles.paragraph).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      width: "100%",
      flexWrap: "wrap",
    });

    expect(styles.text).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      overflowWrap: "anywhere",
    });

    expect(styles.link).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      overflowWrap: "anywhere",
    });

    expect(styles.blocklink).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      overflowWrap: "anywhere",
    });
  });

  it("keeps assistant markdown text selectable on web", () => {
    const styles = createMarkdownStyles(darkTheme);

    expect(styles.body).toMatchObject({
      userSelect: "text",
    });
    expect(styles.text).toMatchObject({
      userSelect: "text",
    });
    expect(styles.heading1).toMatchObject({
      userSelect: "text",
    });
    expect(styles.link).toMatchObject({
      userSelect: "text",
    });
    expect(styles.code_inline).toMatchObject({
      userSelect: "text",
    });
    expect(styles.code_block).toMatchObject({
      userSelect: "text",
    });
    expect(styles.fence).toMatchObject({
      userSelect: "text",
    });
    expect(styles.bullet_list_icon).toMatchObject({
      userSelect: "text",
    });
    expect(styles.ordered_list_icon).toMatchObject({
      userSelect: "text",
    });
  });

  it("uses the mono font-size token directly for inline and block code", () => {
    const styles = createMarkdownStyles(darkTheme);
    const compactStyles = createCompactMarkdownStyles(darkTheme);

    expect(styles.code_inline).toMatchObject({
      fontFamily: darkTheme.fontFamily.mono,
      fontSize: darkTheme.fontSize.code,
    });
    expect(styles.code_inline).not.toHaveProperty("lineHeight");
    expect(styles.code_block).toMatchObject({
      fontFamily: darkTheme.fontFamily.mono,
      fontSize: darkTheme.fontSize.code,
    });
    expect(styles.fence).toMatchObject({
      fontFamily: darkTheme.fontFamily.mono,
      fontSize: darkTheme.fontSize.code,
    });
    expect(compactStyles.code_inline).toMatchObject({
      fontFamily: darkTheme.fontFamily.mono,
      fontSize: darkTheme.fontSize.code,
    });
    expect(compactStyles.code_inline).not.toHaveProperty("lineHeight");
  });

  it("gives the table shell sole ownership of its rounded outside border", () => {
    const styles = createMarkdownStyles(darkTheme);

    expect(styles.table).toMatchObject({
      borderWidth: 1,
      borderRadius: darkTheme.borderRadius.md,
      overflow: "hidden",
    });
    expect(styles.th).not.toHaveProperty("borderBottomWidth");
    expect(styles.tableLastRow).toEqual({ borderBottomWidth: 0 });
    expect(styles.tableLastCell).toEqual({ borderRightWidth: 0 });
  });

  it("scales Markdown headings from content size with safe line heights", () => {
    const largeContentTheme = {
      ...darkTheme,
      fontSize: { ...darkTheme.fontSize, content: 21 },
    };
    const styles = createMarkdownStyles(largeContentTheme);

    const initial = createMarkdownStyles(darkTheme);
    const changedInterface = createMarkdownStyles({
      ...largeContentTheme,
      fontSize: { ...largeContentTheme.fontSize, base: 22, xl: 28, "3xl": 36, code: 18 },
    });
    for (const key of [
      "heading1",
      "heading2",
      "heading3",
      "heading4",
      "heading5",
      "heading6",
    ] as const) {
      expect(styles[key].fontSize).toBeGreaterThan(initial[key].fontSize);
      expect(styles[key].lineHeight).toBeGreaterThan(styles[key].fontSize);
      expect(changedInterface[key]).toEqual(styles[key]);
      expect(styles[key].marginTop).toBe(initial[key].marginTop);
      expect(styles[key].marginBottom).toBe(initial[key].marginBottom);
      expect(styles[key]).not.toHaveProperty("borderBottomWidth");
    }
    // Otto keeps its 3xl/2xl/xl heading tiers instead of upstream's larger tiers.
    expect(styles.heading1).toMatchObject({ fontSize: 34, lineHeight: 42 });
    expect(styles.heading2).toMatchObject({ fontSize: 29, lineHeight: 37 });
    expect(styles.heading3).toMatchObject({ fontSize: 26, lineHeight: 34 });
  });

  it("keeps compact summary text and headings independent of content size", () => {
    const theme = {
      ...darkTheme,
      fontSize: { ...darkTheme.fontSize, sm: 18, base: 20, lg: 23, xl: 25, content: 24, code: 15 },
    };
    const styles = createCompactMarkdownStyles(theme);
    const changedContent = createCompactMarkdownStyles({
      ...theme,
      fontSize: { ...theme.fontSize, content: 12 },
    });
    expect(changedContent).toEqual(styles);
    for (const key of ["body", "text", "bullet_list_icon", "ordered_list_icon"] as const) {
      expect(styles[key]).toMatchObject({ fontSize: 18, lineHeight: 25 });
    }
    for (const key of ["th", "td", "alertTitle"] as const) {
      expect(styles[key].fontSize).toBe(18);
    }
    expect(styles.heading1.fontSize).toBe(25);
    expect(styles.heading2.fontSize).toBe(23);
    expect(styles.heading3.fontSize).toBe(20);
    for (const key of [
      "heading1",
      "heading2",
      "heading3",
      "heading4",
      "heading5",
      "heading6",
    ] as const) {
      expect(styles[key].lineHeight).toBeGreaterThan(styles[key].fontSize);
    }
    for (const key of ["code_inline", "code_block", "fence"] as const) {
      expect(styles[key].fontSize).toBe(15);
    }
  });

  // Otto's blockquote is a rounded card with an accent rule down its left edge,
  // and the GitHub alert kinds are the same card with a different accent - so
  // the radius stays uniform rather than squaring off against the rule.
  it("draws blockquotes as a rounded card behind an accent rule", () => {
    const styles = createMarkdownStyles(darkTheme);

    expect(styles.blockquote).toMatchObject({
      borderLeftWidth: 4,
      borderRadius: darkTheme.borderRadius.md,
      paddingHorizontal: darkTheme.spacing[4],
      paddingVertical: darkTheme.spacing[3],
    });
    expect(styles.blockquote).not.toHaveProperty("borderTopLeftRadius");
    expect(styles.paragraph.marginBottom).toBe(darkTheme.spacing[3]);
  });
});
