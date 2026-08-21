/**
 * @vitest-environment jsdom
 */
import * as React from "react";
import { createElement, type ReactNode } from "react";
import { fireEvent, render } from "@testing-library/react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { describe, expect, it, vi } from "vitest";
import MarkdownIt from "markdown-it";
import {
  collectMarkdownDocumentAnnotationTargets,
  findUniqueHeadingAnnotationTarget,
  resolveHeadingAnnotationTarget,
} from "./annotation-locators";
import { resolveInlineImageSize } from "./inline-image-size";
import { colorMarkdownLinkChildren } from "./link-children";
import { MarkdownLinkText } from "./link-text";

vi.stubGlobal("React", React);

vi.mock("react-native", () => ({
  Pressable: ({
    accessibilityRole,
    children,
    onHoverIn,
    onHoverOut,
    onPress,
  }: {
    accessibilityRole?: string;
    children?: ReactNode;
    onHoverIn?(): void;
    onHoverOut?(): void;
    onPress?(): void;
  }) =>
    createElement(
      "div",
      {
        role: accessibilityRole,
        onClick: onPress,
        onMouseEnter: onHoverIn,
        onMouseLeave: onHoverOut,
      },
      children,
    ),
  Text: ({ children, style }: { children?: ReactNode; style?: StyleProp<TextStyle> }) =>
    createElement("span", { style: flattenStyle(style) }, children),
}));

function flattenStyle(style: StyleProp<TextStyle>): TextStyle {
  return Object.assign({}, ...(Array.isArray(style) ? style.filter(Boolean) : [style]));
}

describe("resolveInlineImageSize", () => {
  it("respects a one-sided explicit width using natural aspect ratio", () => {
    expect(
      resolveInlineImageSize({ explicit: { width: 18 }, natural: { width: 90, height: 45 } }),
    ).toEqual({
      width: 18,
      height: 9,
    });
  });

  it("respects a one-sided explicit height using natural aspect ratio", () => {
    expect(
      resolveInlineImageSize({ explicit: { height: 18 }, natural: { width: 90, height: 45 } }),
    ).toEqual({
      width: 36,
      height: 18,
    });
  });

  it("uses a generic small fallback when no dimensions are known", () => {
    expect(resolveInlineImageSize({ explicit: {}, natural: null })).toEqual({
      width: 16,
      height: 16,
    });
  });
});
describe("collectMarkdownDocumentAnnotationTargets", () => {
  it("keeps durable source ranges for supported rendered markdown blocks", () => {
    const targets = Array.from(
      collectMarkdownDocumentAnnotationTargets({
        markdownit: MarkdownIt({ typographer: true, linkify: true }),
        text: [
          "# Design",
          "",
          "A **source-backed** paragraph.",
          "",
          "> A quoted constraint.",
          "",
          "```ts",
          "const value = 1;",
          "```",
        ].join("\n"),
      }).values(),
    );

    expect(targets).toEqual([
      {
        kind: "heading",
        level: 1,
        lineStart: 1,
        lineEnd: 1,
        text: "Design",
        excerpt: "# Design",
      },
      {
        kind: "paragraph",
        lineStart: 3,
        lineEnd: 3,
        text: "A **source-backed** paragraph.",
        excerpt: "A **source-backed** paragraph.",
      },
      {
        kind: "blockquote",
        lineStart: 5,
        lineEnd: 5,
        text: "",
        excerpt: "> A quoted constraint.",
      },
      {
        kind: "paragraph",
        lineStart: 5,
        lineEnd: 5,
        text: "A quoted constraint.",
        excerpt: "> A quoted constraint.",
      },
      {
        kind: "fence",
        lineStart: 7,
        lineEnd: 9,
        text: "const value = 1;\n",
        excerpt: "```ts\nconst value = 1;\n```",
        language: "ts",
      },
    ]);
  });

  it("keeps an early heading addressable when later prose documents HTML", () => {
    const targets = Array.from(
      collectMarkdownDocumentAnnotationTargets({
        markdownit: MarkdownIt({ typographer: true, linkify: true }),
        text: [
          "# Text editor",
          "",
          "Clipboard output includes a `<span>` and an `<img>` tag.",
        ].join("\n"),
      }).values(),
    );

    expect(targets[0]).toMatchObject({
      kind: "heading",
      lineStart: 1,
      lineEnd: 1,
      text: "Text editor",
    });
  });

  it("resolves every ordinary Markdown heading to its own source occurrence", () => {
    const text = [
      "# Repeat",
      "",
      "<details><summary>Rendered separately</summary></details>",
      "",
      "## Repeat",
      "",
      "### **Formatted** heading",
      "",
      "#### Fourth",
      "",
      "##### Fifth",
      "",
      "###### Sixth",
    ].join("\n");
    const markdownit = MarkdownIt({ typographer: true, linkify: true });
    const targets = collectMarkdownDocumentAnnotationTargets({ markdownit, text });
    const headingTokens = markdownit
      .parse(text, {})
      .map((token, tokenIndex) => ({ token, tokenIndex }))
      .filter(({ token }) => token.type === "heading_open");

    expect(headingTokens).toHaveLength(6);
    expect(
      headingTokens.map(({ token, tokenIndex }) =>
        resolveHeadingAnnotationTarget({
          targets,
          tokenIndex,
          text: token.content,
          level: Number(token.tag.slice(1)),
        }),
      ),
    ).toEqual([
      expect.objectContaining({ lineStart: 1, level: 1, text: "Repeat" }),
      expect.objectContaining({ lineStart: 5, level: 2, text: "Repeat" }),
      expect.objectContaining({ lineStart: 7, level: 3, text: "**Formatted** heading" }),
      expect.objectContaining({ lineStart: 9, level: 4, text: "Fourth" }),
      expect.objectContaining({ lineStart: 11, level: 5, text: "Fifth" }),
      expect.objectContaining({ lineStart: 13, level: 6, text: "Sixth" }),
    ]);
  });

  it("resolves a unique heading after an AST transform reindexes it", () => {
    const targets = collectMarkdownDocumentAnnotationTargets({
      markdownit: MarkdownIt({ typographer: true, linkify: true }),
      text: "# Title\n\n## A transformed heading",
    });

    expect(
      findUniqueHeadingAnnotationTarget({
        targets,
        text: "A transformed heading",
        level: 2,
      }),
    ).toMatchObject({ kind: "heading", lineStart: 3, level: 2 });
  });

  it("matches a typographic heading back to its straight-quote source", () => {
    const targets = collectMarkdownDocumentAnnotationTargets({
      markdownit: MarkdownIt({ typographer: true, linkify: true }),
      text: '## What "dirty" means?',
    });

    expect(
      findUniqueHeadingAnnotationTarget({
        targets,
        text: "What “dirty” means?",
        level: 2,
      }),
    ).toMatchObject({
      kind: "heading",
      lineStart: 1,
      level: 2,
      text: 'What "dirty" means?',
    });
  });
});
describe("shared Markdown links", () => {
  it("renders accent text and underlines it while hovered", () => {
    const onPress = vi.fn();
    const children = colorMarkdownLinkChildren(
      createElement(Text, { style: { color: "white" } }, "Otto"),
      "rgb(0, 122, 255)",
    );
    const view = render(
      createElement(MarkdownLinkText, { style: { color: "rgb(0, 122, 255)" }, onPress }, children),
    );
    const link = view.getByRole("link");
    const linkText = link.firstElementChild as HTMLElement;

    expect((view.getByText("Otto") as HTMLElement).style.color).toBe("rgb(0, 122, 255)");
    expect(linkText.style.textDecorationLine).toBe("");

    fireEvent.mouseEnter(link);
    expect(linkText.style.textDecorationLine).toBe("underline");

    fireEvent.mouseLeave(link);
    expect(linkText.style.textDecorationLine).toBe("");

    fireEvent.click(link);
    expect(onPress).toHaveBeenCalledOnce();
  });
});
