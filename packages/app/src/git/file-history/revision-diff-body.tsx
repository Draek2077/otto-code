import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { GitBlameCommit } from "@otto-code/protocol/messages";
import { DiffScroll } from "@/components/diff-scroll";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { syntaxTokenStyleFor } from "@/styles/syntax-token-styles";
import { compactFont } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import type { DiffLine, ParsedDiffFile } from "@/git/use-diff-query";
import { buildNumberedDiffHunks, type NumberedDiffLine } from "@/utils/diff-layout";
import { formatDiffContentText, hasVisibleDiffTokens } from "@/utils/diff-rendering";
import { buildBlameRunFlags } from "./blame-runs";

/**
 * One revision's diff, rendered with a real gutter: blame, then the pre-image
 * and post-image line numbers, then the code.
 *
 * Blame lives here rather than in a view of its own. Blame answered as a
 * separate table is a list of shas next to a list of authors — the code it
 * describes is somewhere else entirely. Beside the line it annotates, it answers
 * the question people actually ask ("who wrote *this*"), which is why every IDE
 * puts it in the gutter.
 *
 * Blame is resolved **at the revision being viewed**, not at HEAD, so the
 * post-image line numbers this diff is keyed on are the same ones blame is
 * talking about. Removed lines get no blame: they do not exist at this revision.
 */

export interface RevisionDiffBodyProps {
  file: ParsedDiffFile;
  /** Blame for the post-image, keyed by line number. Empty when unavailable. */
  blameByLine: ReadonlyMap<number, GitBlameCommit>;
  /** Select a commit from a blame annotation. */
  onSelectBlameCommit?: (commit: GitBlameCommit) => void;
}

interface DiffRow {
  key: string;
  line: DiffLine;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

function buildRows(file: ParsedDiffFile): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const hunk of buildNumberedDiffHunks(file)) {
    rows.push({
      key: `hunk-${hunk.hunkIndex}`,
      line: { type: "header", content: hunk.hunkHeader },
      oldLineNumber: null,
      newLineNumber: null,
    });
    for (const numbered of hunk.lines) {
      rows.push(toDiffRow(numbered));
    }
  }
  return rows;
}

function toDiffRow(numbered: NumberedDiffLine): DiffRow {
  return {
    key: numbered.key,
    line: numbered.line,
    oldLineNumber: numbered.oldLineNumber,
    newLineNumber: numbered.newLineNumber,
  };
}

/**
 * Width for a line-number column, sized to the widest number it will actually
 * hold — and zero when it holds none, so the column disappears entirely.
 *
 * Sized per column rather than from the diff's overall maximum: a hunk near the
 * top of a long file numbers its pre-image in the tens and its post-image in the
 * thousands, and one shared width would pad the narrow column out to the wide
 * one's size for no reason. A file with no pre-image at all (a newly created
 * one) should not reserve a column of blanks.
 */
function numberColumnWidth(highest: number, fontSize: number): number {
  if (highest <= 0) {
    return 0;
  }
  const digits = String(highest).length;
  return digits * Math.ceil(fontSize * 0.62) + GUTTER_PADDING_X * 2;
}

/**
 * Width for the blame column, sized to the longest author name it will actually
 * print. The text is monospaced like the rest of the row, so character count is
 * an exact measure. Capped, because one contributor with a very long name should
 * not push the code off screen for every row — that name ellipsizes and keeps
 * its full form on the cell's accessibility label.
 */
function blameColumnWidth(annotations: (GitBlameCommit | null)[], fontSize: number): number {
  let longest = 0;
  for (const commit of annotations) {
    if (commit) {
      longest = Math.max(longest, commit.authorName.length);
    }
  }
  if (longest === 0) {
    return 0;
  }
  const width = longest * Math.ceil(fontSize * 0.62) + GUTTER_PADDING_X * 2;
  return Math.min(BLAME_COLUMN_MAX_WIDTH, width);
}

function highestOldLineNumber(rows: DiffRow[]): number {
  return rows.reduce((highest, row) => Math.max(highest, row.oldLineNumber ?? 0), 0);
}

function highestNewLineNumber(rows: DiffRow[]): number {
  return rows.reduce((highest, row) => Math.max(highest, row.newLineNumber ?? 0), 0);
}

export function RevisionDiffBody({
  file,
  blameByLine,
  onSelectBlameCommit,
}: RevisionDiffBodyProps) {
  const isCompact = useIsCompactFormFactor();
  const [scrollWidth, setScrollWidth] = useState(0);
  const verticalScrollRef = useRef<ScrollView>(null);
  const horizontalScrollRef = useRef<ScrollView>(null);
  // Neither axis is gated on form factor: a narrow browser window still draws
  // the platform's dated bar, so compact web needs the overlay just as much.
  const scrollbar = useWebScrollViewScrollbar(verticalScrollRef, { enabled: isWeb });
  // The code column's horizontal scroller lives *inside* the vertical one, so its
  // own overlay would sit at the bottom of the content rather than the viewport.
  // It is hosted here instead, against the pane, and fed metrics from there.
  const horizontalScrollbar = useWebScrollViewScrollbar(horizontalScrollRef, {
    enabled: isWeb,
    axis: "horizontal",
  });

  const rows = useMemo(() => buildRows(file), [file]);
  // Gutter columns are sized in pixels from the code font, which grows on compact
  // — measuring with the desktop size there would clip the widest line number.
  const codeFontSize = isCompact ? CODE_FONT_SIZE + COMPACT_CODE_FONT_BUMP : CODE_FONT_SIZE;
  const oldNumberWidth = useMemo(
    () => numberColumnWidth(highestOldLineNumber(rows), codeFontSize),
    [rows, codeFontSize],
  );
  const newNumberWidth = useMemo(
    () => numberColumnWidth(highestNewLineNumber(rows), codeFontSize),
    [rows, codeFontSize],
  );
  // A blame annotation repeated on every line of a run is noise that hides the
  // one thing blame is for: where authorship changes. Print it once per run.
  const blameRows = useMemo(() => buildBlameRows(rows, blameByLine), [rows, blameByLine]);
  const blameWidth = useMemo(
    () => blameColumnWidth(blameRows, codeFontSize),
    [blameRows, codeFontSize],
  );

  const gutterWidth = blameWidth + oldNumberWidth + newNumberWidth;
  const horizontalOverlayStyle = useMemo(
    () => [styles.horizontalScrollbarHost, inlineUnistylesStyle({ left: gutterWidth })],
    [gutterWidth],
  );
  const codeContainerStyle = useMemo(
    () => [styles.codeColumn, scrollWidth > 0 && inlineUnistylesStyle({ minWidth: scrollWidth })],
    [scrollWidth],
  );

  return (
    <View style={styles.host}>
      <ScrollView
        ref={verticalScrollRef}
        style={styles.verticalScroll}
        onLayout={scrollbar.onLayout}
        onScroll={scrollbar.onScroll}
        onContentSizeChange={scrollbar.onContentSizeChange}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={!isWeb}
        nestedScrollEnabled
      >
        <View style={styles.row} dataSet={CODE_SURFACE_DATASET}>
          <View style={inlineUnistylesStyle({ width: gutterWidth })}>
            {rows.map((row, index) => (
              <GutterRow
                key={row.key}
                row={row}
                oldNumberWidth={oldNumberWidth}
                newNumberWidth={newNumberWidth}
                blame={blameRows[index] ?? null}
                blameWidth={blameWidth}
                onSelectBlameCommit={onSelectBlameCommit}
              />
            ))}
          </View>
          <DiffScroll
            scrollViewWidth={scrollWidth}
            onScrollViewWidthChange={setScrollWidth}
            style={styles.codeScroll}
            scrollRef={horizontalScrollRef}
            onScroll={horizontalScrollbar.onScroll}
            onContentSizeChange={horizontalScrollbar.onContentSizeChange}
            onLayout={horizontalScrollbar.onLayout}
          >
            <View style={codeContainerStyle}>
              {rows.map((row) => (
                <CodeRow key={row.key} row={row} />
              ))}
            </View>
          </DiffScroll>
        </View>
      </ScrollView>
      {scrollbar.overlay}
      {/* Inset past the gutter, which does not scroll horizontally: the bar has
          to span exactly the region it scrolls, or its travel lies about where
          in the line you are. */}
      <View style={horizontalOverlayStyle} pointerEvents="box-none">
        {horizontalScrollbar.overlay}
      </View>
    </View>
  );
}

/**
 * The blame annotation to draw on each row, or null where the previous row
 * already carries the same commit (run collapsing) or blame does not apply.
 */
function buildBlameRows(
  rows: DiffRow[],
  blameByLine: ReadonlyMap<number, GitBlameCommit>,
): (GitBlameCommit | null)[] {
  const flags = buildBlameRunFlags(rows, (line) => blameByLine.get(line)?.sha);
  return flags.map((sha, index) => {
    const line = rows[index]?.newLineNumber;
    return sha !== null && line !== null && line !== undefined
      ? (blameByLine.get(line) ?? null)
      : null;
  });
}

function GutterRow({
  row,
  oldNumberWidth,
  newNumberWidth,
  blame,
  blameWidth,
  onSelectBlameCommit,
}: {
  row: DiffRow;
  oldNumberWidth: number;
  newNumberWidth: number;
  blame: GitBlameCommit | null;
  blameWidth: number;
  onSelectBlameCommit?: (commit: GitBlameCommit) => void;
}) {
  const oldCellStyle = useMemo(
    () => [styles.gutterCell, inlineUnistylesStyle({ width: oldNumberWidth })],
    [oldNumberWidth],
  );
  const newCellStyle = useMemo(
    () => [
      styles.gutterCell,
      styles.gutterCellDivider,
      inlineUnistylesStyle({ width: newNumberWidth }),
    ],
    [newNumberWidth],
  );
  const rowStyle = useMemo(
    () => [styles.gutterRow, lineBackgroundStyle(row.line.type)],
    [row.line.type],
  );
  const numberTextStyle = useMemo(
    () => [
      styles.codeMetrics,
      styles.lineNumberText,
      row.line.type === "add" && styles.addLineNumberText,
      row.line.type === "remove" && styles.removeLineNumberText,
    ],
    [row.line.type],
  );

  return (
    <View style={rowStyle}>
      {blameWidth > 0 ? (
        <BlameCell blame={blame} width={blameWidth} onSelectBlameCommit={onSelectBlameCommit} />
      ) : null}
      {oldNumberWidth > 0 ? (
        <View style={oldCellStyle}>
          <Text numberOfLines={1} style={numberTextStyle}>
            {row.oldLineNumber ?? ""}
          </Text>
        </View>
      ) : null}
      <View style={newCellStyle}>
        <Text numberOfLines={1} style={numberTextStyle}>
          {row.newLineNumber ?? ""}
        </Text>
      </View>
    </View>
  );
}

function BlameCell({
  blame,
  width,
  onSelectBlameCommit,
}: {
  blame: GitBlameCommit | null;
  width: number;
  onSelectBlameCommit?: (commit: GitBlameCommit) => void;
}) {
  const handlePress = useCallback(() => {
    if (blame) {
      onSelectBlameCommit?.(blame);
    }
  }, [blame, onSelectBlameCommit]);
  const widthStyle = useMemo(() => inlineUnistylesStyle({ width }), [width]);
  const emptyStyle = useMemo(() => [styles.blameCell, widthStyle], [widthStyle]);
  const pressableStyle = useCallback(
    ({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => [
      styles.blameCell,
      widthStyle,
      (Boolean(hovered) || pressed) && styles.blameCellHovered,
    ],
    [widthStyle],
  );

  if (!blame) {
    return <View style={emptyStyle} />;
  }
  return (
    <Pressable
      style={pressableStyle}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${blame.authorName} — ${blame.shortSha}`}
    >
      <Text numberOfLines={1} style={BLAME_TEXT_STYLE}>
        {blame.authorName}
      </Text>
    </Pressable>
  );
}

function CodeRow({ row }: { row: DiffRow }) {
  const tokens = hasVisibleDiffTokens(row.line.tokens) ? row.line.tokens : null;
  // Tokens have no identity of their own — position is the only stable key, so
  // it is baked in here rather than derived inside the JSX.
  const keyedTokens = useMemo(
    () => (tokens ?? []).map((token, index) => ({ key: `${index}-${token.text}`, token })),
    [tokens],
  );
  const containerStyle = useMemo(
    () => [styles.codeRow, lineBackgroundStyle(row.line.type)],
    [row.line.type],
  );
  const textStyle = useMemo(
    () => [
      styles.codeMetrics,
      styles.codeText,
      row.line.type === "header" && styles.headerLineText,
      row.line.type === "context" && styles.contextLineText,
    ],
    [row.line.type],
  );

  return (
    <View style={containerStyle}>
      {row.line.type !== "header" && tokens ? (
        <Text style={CODE_TEXT_STYLE}>
          {keyedTokens.map(({ key, token }) => (
            <Text key={key} style={syntaxTokenStyleFor(token.style)}>
              {token.text}
            </Text>
          ))}
        </Text>
      ) : (
        <Text style={textStyle}>{formatDiffContentText(row.line.content)}</Text>
      )}
    </View>
  );
}

function lineBackgroundStyle(type: DiffLine["type"]) {
  if (type === "add") return styles.addLine;
  if (type === "remove") return styles.removeLine;
  if (type === "header") return styles.headerLine;
  return styles.contextLine;
}

// The gutter width math runs before styles resolve, so these cannot come from
// the theme object here. CODE_FONT_SIZE mirrors theme.fontSize.code.
const CODE_FONT_SIZE = 12;
/** Compact bump for the code font — mirrors `compactFont`'s default. */
const COMPACT_CODE_FONT_BUMP = 2;
/**
 * Compact bump for the line box. Larger than the font bump: the row heights are
 * also the diff's touch targets, and a line box that only grows by the font's
 * two points leaves the bigger glyphs with no leading at all.
 */
const COMPACT_LINE_HEIGHT_BUMP = 6;
/**
 * Padding on **each side** of a gutter column's text, added twice when sizing
 * the column. It has to be symmetric: the numbers are right-aligned, so padding
 * applied only on the right leaves the widest number touching the column's left
 * edge — hard against the divider or the blame cell beside it.
 */
const GUTTER_PADDING_X = 6;
/** Ceiling on the blame column, so one long name cannot crowd out the code. */
const BLAME_COLUMN_MAX_WIDTH = 160;

const styles = StyleSheet.create((theme) => ({
  host: {
    flex: 1,
    minHeight: 0,
    position: "relative",
  },
  verticalScroll: {
    flex: 1,
  },
  // Full height rather than a 12px strip, so the overlay's own absolute
  // positioning lands its bar on the pane's bottom edge.
  horizontalScrollbarHost: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  // Line metrics are shared by the gutter and the code so the two columns stay
  // locked together, and match the text editor's density rather than adding
  // per-line padding — padded diff lines drift out of step with the editor and
  // read as double-spaced.
  codeMetrics: {
    fontSize: compactFont(theme.fontSize.code, COMPACT_CODE_FONT_BUMP),
    lineHeight: compactFont(theme.lineHeight.diff, COMPACT_LINE_HEIGHT_BUMP),
    fontFamily: theme.fontFamily.mono,
  },
  gutterRow: {
    flexDirection: "row",
    alignItems: "stretch",
    minHeight: compactFont(theme.lineHeight.diff, COMPACT_LINE_HEIGHT_BUMP),
  },
  gutterCell: {
    justifyContent: "flex-start",
  },
  gutterCellDivider: {
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
  },
  // Symmetric padding, matching what numberColumnWidth reserves. Right-aligned
  // text with right-only padding pins the widest number to the column's left
  // edge, so the number hugs whatever sits beside it.
  lineNumberText: {
    width: "100%",
    textAlign: "right",
    paddingHorizontal: GUTTER_PADDING_X,
    color: theme.colors.foregroundMuted,
    userSelect: "none",
  },
  addLineNumberText: {
    color: theme.colors.diffAddition,
  },
  removeLineNumberText: {
    color: theme.colors.diffDeletion,
  },
  blameCell: {
    justifyContent: "center",
    paddingHorizontal: GUTTER_PADDING_X,
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
  },
  blameCellHovered: {
    backgroundColor: theme.colors.surface2,
  },
  // Deliberately no font of its own: the blame cell takes the row's code
  // metrics like every other gutter cell. A second font size in the gutter makes
  // the annotation sit off the row's baseline and reads as a rendering fault.
  blameText: {
    color: theme.colors.foregroundMuted,
    userSelect: "none",
  },
  codeScroll: {
    flex: 1,
  },
  codeColumn: {
    flexDirection: "column",
  },
  codeRow: {
    minWidth: "100%",
    minHeight: compactFont(theme.lineHeight.diff, COMPACT_LINE_HEIGHT_BUMP),
    paddingLeft: theme.spacing[2],
  },
  codeText: {
    color: theme.colors.foreground,
    ...(isWeb ? { whiteSpace: "pre", overflowWrap: "normal" } : null),
  },
  headerLine: {
    backgroundColor: theme.colors.surface1,
  },
  headerLineText: {
    color: theme.colors.foregroundMuted,
  },
  addLine: {
    backgroundColor: theme.colors.syntax.diffAdded,
  },
  removeLine: {
    backgroundColor: theme.colors.syntax.diffRemoved,
  },
  contextLine: {
    backgroundColor: theme.colors.surface1,
  },
  contextLineText: {
    color: theme.colors.foregroundMuted,
  },
}));

const CODE_TEXT_STYLE = [styles.codeMetrics, styles.codeText];
const BLAME_TEXT_STYLE = [styles.codeMetrics, styles.blameText];
