import React from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { syntaxTokenStyleFor } from "@/styles/syntax-token-styles";
import type { KeyedLine, KeyedToken } from "@/utils/highlight-cache";

// Line height kept in sync with the plain `scrollText` style in
// tool-call-details so a highlighted block lines up with an unhighlighted
// fallback and blank lines keep their height.
const CODE_LINE_HEIGHT = 18;
const ZERO_WIDTH = "​";

interface HighlightedLinesProps {
  lines: KeyedLine[];
  // 1-based line number of the first line; when set, a line-number gutter is
  // rendered (used by Read, which carries a server-normalized offset).
  startLine?: number;
  // "Wrap long lines" appearance setting: soft-wrap long lines instead of
  // relying on a surrounding horizontal scroller. Visual only — selection/copy
  // still yields the original unwrapped text. Tokenization is untouched, so
  // syntax highlighting is unaffected.
  wrap?: boolean;
}

function ContentLine({ line, wrap }: { line: KeyedLine; wrap: boolean }) {
  return (
    <Text selectable style={wrap ? LINE_TEXT_WRAP_STYLE : styles.lineText}>
      {line.tokens.length === 0
        ? ZERO_WIDTH
        : line.tokens.map(({ key, token }: KeyedToken) => (
            <Text key={key} style={token.style ? syntaxTokenStyleFor(token.style) : undefined}>
              {token.text}
            </Text>
          ))}
    </Text>
  );
}

const GutteredLine = React.memo(function GutteredLine({
  line,
  lineNumber,
  digits,
  wrap,
}: {
  line: KeyedLine;
  lineNumber: number;
  digits: number;
  wrap: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.gutterText}>{String(lineNumber).padStart(digits)} </Text>
      <ContentLine line={line} wrap={wrap} />
    </View>
  );
});

// Renders pre-tokenized lines (from the shared highlight cache), optionally with
// a line-number gutter. Callers decide whether to highlight at all, so the
// expensive size-cap / unsupported-language fallback stays a single plain Text.
export function HighlightedLines({ lines, startLine, wrap = false }: HighlightedLinesProps) {
  if (startLine === undefined) {
    return (
      <View dataSet={CODE_SURFACE_DATASET}>
        {lines.map((line) => (
          <ContentLine key={line.key} line={line} wrap={wrap} />
        ))}
      </View>
    );
  }

  const lastLineNumber = startLine + lines.length - 1;
  const digits = Math.max(2, String(lastLineNumber).length);
  return (
    <View dataSet={CODE_SURFACE_DATASET}>
      {lines.map((line, index) => (
        <GutteredLine
          key={line.key}
          line={line}
          lineNumber={startLine + index}
          digits={digits}
          wrap={wrap}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    minHeight: CODE_LINE_HEIGHT,
  },
  gutterText: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    lineHeight: CODE_LINE_HEIGHT,
    color: theme.colors.foregroundMuted,
    opacity: 0.6,
    userSelect: "none",
    flexShrink: 0,
  },
  lineText: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foreground,
    lineHeight: CODE_LINE_HEIGHT,
    ...(isWeb
      ? {
          whiteSpace: "pre",
          overflowWrap: "normal",
        }
      : null),
  },
  // Layered over lineText when "Wrap long lines" is on. flexShrink keeps a
  // wrapped line inside the gutter row's remaining width instead of pushing
  // the row wider; web needs the explicit pre-wrap (lineText forces `pre`).
  lineTextWrap: {
    flexShrink: 1,
    minWidth: 0,
    ...(isWeb
      ? {
          whiteSpace: "pre-wrap" as const,
          overflowWrap: "anywhere" as const,
        }
      : null),
  },
}));

const LINE_TEXT_WRAP_STYLE = [styles.lineText, styles.lineTextWrap];
