import { useMemo } from "react";
import { Text, type TextStyle } from "react-native";
import type { ASTNode, RenderRules } from "react-native-markdown-display";
import { findHighlightStyles } from "@/components/find-highlight-styles";
import {
  splitTextForMatches,
  type MatchedTextSegment,
  type PreviewLineMatchRange,
} from "@/components/file-preview-find";
import {
  createSharedMarkdownRules,
  MarkdownInheritedText,
  type MarkdownStyles,
} from "@/components/markdown/renderer";

// Find highlighting for a rendered document.
//
// These rules replace only the two that put a document's own words on screen,
// `text` and `code_inline`, and they replace them with the same
// `MarkdownInheritedText` the shared rules use - so a highlighted paragraph
// keeps every style it would have had, and the hit is a background on the
// matched run and nothing else. Everything structural (headings, lists, links,
// annotation targets) is left to whichever rules were already in play.

const SEGMENT_HIGHLIGHT_STYLE = {
  active: findHighlightStyles.active,
  match: findHighlightStyles.match,
} as const;

function HighlightedSegment({ segment }: { segment: MatchedTextSegment }) {
  const style = segment.highlight ? SEGMENT_HIGHLIGHT_STYLE[segment.highlight] : undefined;
  return <Text style={style}>{segment.text}</Text>;
}

function FoundText({
  content,
  ranges,
  inheritedStyles,
  textStyle,
  monoSurface,
}: {
  content: string;
  ranges: readonly PreviewLineMatchRange[];
  inheritedStyles: TextStyle;
  textStyle: TextStyle;
  monoSurface?: boolean;
}) {
  const keyed = useMemo(
    () =>
      splitTextForMatches(content, ranges).map((segment, index) => ({
        key: `${index}-${segment.text}`,
        segment,
      })),
    [content, ranges],
  );
  return (
    <MarkdownInheritedText
      inheritedStyles={inheritedStyles}
      textStyle={textStyle}
      monoSurface={monoSurface}
    >
      {keyed.map(({ key, segment }) => (
        <HighlightedSegment key={key} segment={segment} />
      ))}
    </MarkdownInheritedText>
  );
}

/**
 * Layer find highlighting over an existing rule set.
 *
 * `base` is whatever the surface was already rendering with (the shared rules,
 * or the annotation rules when the document is source-addressable). Only the
 * text-bearing rules are overridden, so this composes rather than competes:
 * annotation rules own `heading*` and `fence`, these own `text` and
 * `code_inline`, and neither has to know about the other.
 */
export function createMarkdownFindRules(
  base: RenderRules,
  byContent: ReadonlyMap<string, PreviewLineMatchRange[]>,
): RenderRules {
  // Every rule in `RenderRules` is optional, and a caller is free to hand over
  // a set that leaves the text rules to the defaults. Resolve the fallbacks
  // once here so a run with no hits renders through exactly what it would have
  // rendered through with find closed.
  const shared = createSharedMarkdownRules();
  const renderPlainText = base.text ?? shared.text;
  const renderPlainCodeInline = base.code_inline ?? shared.code_inline;
  return {
    ...base,
    text: (
      node: ASTNode,
      children: React.ReactNode[],
      parent: ASTNode[],
      styles: MarkdownStyles,
      inheritedStyles: TextStyle = {},
    ) => {
      const ranges = byContent.get(node.content);
      if (!ranges || ranges.length === 0) {
        return renderPlainText?.(node, children, parent, styles, inheritedStyles) ?? null;
      }
      return (
        <FoundText
          key={node.key}
          content={node.content}
          ranges={ranges}
          inheritedStyles={inheritedStyles}
          textStyle={styles.text}
        />
      );
    },
    code_inline: (
      node: ASTNode,
      children: React.ReactNode[],
      parent: ASTNode[],
      styles: MarkdownStyles,
      inheritedStyles: TextStyle = {},
    ) => {
      const ranges = byContent.get(node.content);
      if (!ranges || ranges.length === 0) {
        return renderPlainCodeInline?.(node, children, parent, styles, inheritedStyles) ?? null;
      }
      return (
        <FoundText
          key={node.key}
          content={node.content}
          ranges={ranges}
          inheritedStyles={inheritedStyles}
          textStyle={styles.code_inline}
          monoSurface
        />
      );
    },
  };
}
