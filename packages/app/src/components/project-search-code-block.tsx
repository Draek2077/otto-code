import { memo, useCallback, useMemo, useState, type ComponentProps } from "react";
import { Pressable, Text, View, type TextStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check } from "@/components/icons/material-icons";
import { lineNumberGutterWidth } from "@/components/code-insets";
import {
  getSearchLineSegments,
  searchHighlightExtension,
  type SearchDisplayLine,
} from "@/components/project-search-code-lines";
import { findHighlightStyles } from "@/components/find-highlight-styles";
import { isNative, isWeb } from "@/constants/platform";
import { useAppSettings, useAppSettingValue } from "@/hooks/use-settings";
import {
  getInlineReviewThreadState,
  InlineReviewGutterCell,
  InlineReviewThread,
  type InlineReviewActions,
} from "@/review";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { syntaxTokenStyleFor } from "@/styles/syntax-token-styles";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import type { Theme } from "@/styles/theme";
import { buildReviewableDiffTargetKey, type ReviewableDiffTarget } from "@/utils/diff-layout";
import type { ReviewDraftComment } from "@/review";

const accentForegroundIconColorMapping = (theme: Theme) => ({
  color: theme.colors.accentForeground,
});
const ThemedCheck = withUnistyles(Check);

const selectCodeFontSize = (settings: { codeFontSize: number }) => settings.codeFontSize;

// The number cell's own right inset (theme.spacing[2]). It lives inside the
// cell rather than on the gutter container so the cell spans the full gutter,
// which is what the review "+" button anchors to.
const GUTTER_RIGHT_INSET = 8;

type WrappedWebTextStyle = TextStyle & {
  whiteSpace?: "pre" | "pre-wrap";
  overflowWrap?: "normal" | "anywhere";
};

/** Web line-wrapping switch, matching the diff viewer's (see @/git/diff-pane). */
function getWrappedTextStyle(wrapLines: boolean): WrappedWebTextStyle | undefined {
  if (isNative) {
    return undefined;
  }
  return wrapLines
    ? { whiteSpace: "pre-wrap", overflowWrap: "anywhere" }
    : { whiteSpace: "pre", overflowWrap: "normal" };
}

const EMPTY_COMMENTS: readonly ReviewDraftComment[] = [];

/**
 * The Changes checkbox, in the two sizes the Search pane needs: a file-row box,
 * and a smaller one that fits inside a code line.
 */
export function SearchSelectionBox({
  checked,
  compact = false,
  accessibilityLabel,
  testID,
  onPress,
}: {
  checked: boolean;
  compact?: boolean;
  accessibilityLabel: string;
  testID: string;
  onPress: () => void;
}) {
  const accessibilityState = useMemo(() => ({ checked }), [checked]);
  const style = useMemo(
    () => [styles.checkbox, compact && styles.checkboxCompact, checked && styles.checkboxChecked],
    [checked, compact],
  );
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      aria-checked={checked}
      testID={testID}
      onPress={onPress}
      hitSlop={6}
      style={style}
    >
      {checked ? <ThemedCheck size="xs" uniProps={accentForegroundIconColorMapping} /> : null}
    </Pressable>
  );
}

/**
 * A search hit is a line in the working tree, so it takes the `new` side of the
 * review target shape. The target key is the shape Changes uses; the bucket the
 * note lands in is not (see `buildSearchNoteDraftKey`).
 */
function buildSearchReviewTarget(
  filePath: string,
  line: SearchDisplayLine,
  lineIndex: number,
): ReviewableDiffTarget {
  return {
    key: buildReviewableDiffTargetKey({ filePath, side: "new", lineNumber: line.line }),
    filePath,
    hunkHeader: "",
    hunkIndex: 0,
    lineIndex,
    oldLineNumber: null,
    newLineNumber: line.line,
    side: "new",
    lineNumber: line.line,
    lineType: "context",
    content: line.text,
  };
}

interface SearchCodeBlockProps {
  filePath: string;
  lines: readonly SearchDisplayLine[];
  /**
   * The file's highest matched line, which sizes the gutter. Taken from the
   * file rather than from `lines`, so every chunk of one file's hits rules the
   * same gutter and the code column does not step as the reader scrolls.
   */
  maxLineNumber: number;
  /** A file's hits arrive in chunks; only the outer ones frame the well. */
  isFirstChunk: boolean;
  isLastChunk: boolean;
  /** Replace mode: each line carries the selection for its own matches. */
  showSelection: boolean;
  /** Wrap long hits across several rows instead of clipping them to one. */
  wrapLines: boolean;
  // The pane owns these, so they take the path rather than closing over it -
  // per-block closures would change identity on every render and defeat the
  // row memoization a long result list depends on.
  isLineChecked: (filePath: string, line: SearchDisplayLine) => boolean;
  toggleLabel: string;
  onToggleLine: (filePath: string, line: SearchDisplayLine) => void;
  onPressLine: (filePath: string, line: SearchDisplayLine) => void;
  onLineContextMenu?: (filePath: string, line: SearchDisplayLine, event: unknown) => void;
  /** Inline comments, on the review surface Changes writes to. */
  reviewActions?: InlineReviewActions;
  testIDPrefix: string;
  /**
   * Index of this chunk's first line within the file. A line's position has to
   * be named against the file, not against the chunk it happened to land in,
   * or two chunks would report the same line indices.
   */
  lineOffset: number;
}

/**
 * A file's matches as a code well: the Changes diff surface without the diff -
 * the same rail, marker column, and code metrics, with the hit lit up by the
 * shared find highlight.
 */
export const SearchCodeBlock = memo(function SearchCodeBlock({
  filePath,
  lines,
  maxLineNumber,
  isFirstChunk,
  isLastChunk,
  showSelection,
  wrapLines,
  isLineChecked,
  toggleLabel,
  onToggleLine,
  onPressLine,
  onLineContextMenu,
  reviewActions,
  testIDPrefix,
  lineOffset,
}: SearchCodeBlockProps) {
  const codeFontSize = useAppSettingValue(selectCodeFontSize);
  const { settings } = useAppSettings();
  const codeLineHeight = Math.round(codeFontSize * 1.5);
  const typography = useMemo(() => {
    const monoFontFamily = settings.monoFontFamily.trim();
    return {
      fontSize: codeFontSize,
      lineHeight: codeLineHeight,
      ...(monoFontFamily ? { fontFamily: monoFontFamily } : null),
    };
  }, [codeFontSize, codeLineHeight, settings.monoFontFamily]);
  const gutterWidth = useMemo(() => {
    // The right inset rides inside the number cell (not on the gutter View), so
    // the cell reaches the divider: the review gutter's "+" button anchors to
    // the cell's right edge, and that is what centers it on the divider line -
    // the same geometry the diff gutter uses.
    return lineNumberGutterWidth(maxLineNumber, codeFontSize, GUTTER_RIGHT_INSET, 1);
  }, [codeFontSize, maxLineNumber]);
  const gutterNumberStyle = useMemo(
    () => [styles.gutterNumber, typography, inlineUnistylesStyle({ width: gutterWidth })],
    [gutterWidth, typography],
  );
  const markerStyle = useMemo(() => [styles.lineMarker, typography], [typography]);
  const rowMinHeightStyle = useMemo(
    () => inlineUnistylesStyle({ minHeight: codeLineHeight }),
    [codeLineHeight],
  );

  // The grammar, resolved once for the file. Each line's tokens are cut out
  // lazily by the line itself (see getSearchLineSegments): a wide search can
  // carry thousands of hits, and tokenizing a whole file's worth up front costs
  // the same whether the reader ever scrolls to them or not.
  const highlightExt = useMemo(() => searchHighlightExtension(filePath), [filePath]);

  const codeTextStyle = useMemo(
    () => [
      styles.codeText,
      // No grammar for this file, so there are no token colours to carry. The
      // diff viewer mutes an unhighlighted context line the same way.
      highlightExt === null && styles.codeTextPlain,
      typography,
      getWrappedTextStyle(wrapLines),
    ],
    [highlightExt, typography, wrapLines],
  );
  const handleToggleLine = useCallback(
    (line: SearchDisplayLine) => onToggleLine(filePath, line),
    [filePath, onToggleLine],
  );
  const handlePressLine = useCallback(
    (line: SearchDisplayLine) => onPressLine(filePath, line),
    [filePath, onPressLine],
  );
  const handleLineContextMenu = useMemo(
    () =>
      onLineContextMenu
        ? (line: SearchDisplayLine, event: unknown) => onLineContextMenu(filePath, line, event)
        : undefined,
    [filePath, onLineContextMenu],
  );

  const surfaceStyle = useMemo(
    () => [
      styles.surface,
      isFirstChunk && styles.surfaceFirstChunk,
      isLastChunk && styles.surfaceLastChunk,
    ],
    [isFirstChunk, isLastChunk],
  );

  return (
    <View style={surfaceStyle} dataSet={CODE_SURFACE_DATASET}>
      {lines.map((line, index) => (
        <SearchCodeLine
          key={line.key}
          filePath={filePath}
          line={line}
          lineIndex={lineOffset + index}
          highlightExt={highlightExt}
          showSelection={showSelection}
          wrapLines={wrapLines}
          checked={isLineChecked(filePath, line)}
          toggleLabel={toggleLabel}
          codeLineHeight={codeLineHeight}
          rowMinHeightStyle={rowMinHeightStyle}
          gutterNumberStyle={gutterNumberStyle}
          markerStyle={markerStyle}
          codeTextStyle={codeTextStyle}
          reviewActions={reviewActions}
          onToggleLine={handleToggleLine}
          onPressLine={handlePressLine}
          onLineContextMenu={handleLineContextMenu}
          testID={`${testIDPrefix}-${lineOffset + index}`}
        />
      ))}
    </View>
  );
});

type ComposedTextStyle = ComponentProps<typeof Text>["style"];
type ComposedViewStyle = ComponentProps<typeof View>["style"];

const SearchCodeLine = memo(function SearchCodeLine({
  filePath,
  line,
  lineIndex,
  highlightExt,
  showSelection,
  wrapLines,
  checked,
  toggleLabel,
  codeLineHeight,
  rowMinHeightStyle,
  gutterNumberStyle,
  markerStyle,
  codeTextStyle,
  reviewActions,
  onToggleLine,
  onPressLine,
  onLineContextMenu,
  testID,
}: {
  filePath: string;
  line: SearchDisplayLine;
  lineIndex: number;
  /** The file's grammar, or null when its lines render as plain text. */
  highlightExt: string | null;
  showSelection: boolean;
  wrapLines: boolean;
  checked: boolean;
  toggleLabel: string;
  codeLineHeight: number;
  rowMinHeightStyle: ComposedViewStyle;
  gutterNumberStyle: ComposedTextStyle;
  markerStyle: ComposedTextStyle;
  codeTextStyle: ComposedTextStyle;
  reviewActions?: InlineReviewActions;
  onToggleLine: (line: SearchDisplayLine) => void;
  onPressLine: (line: SearchDisplayLine) => void;
  onLineContextMenu?: (line: SearchDisplayLine, event: unknown) => void;
  testID: string;
}) {
  // Hover lives on the plain View and press on the inner Pressables, so the
  // gutter's comment button cannot steal the row's hover (docs/hover.md).
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const handlePress = useCallback(() => onPressLine(line), [line, onPressLine]);
  const handleToggle = useCallback(() => onToggleLine(line), [line, onToggleLine]);
  const handleContextMenu = useCallback(
    (event: unknown) => onLineContextMenu?.(line, event),
    [line, onLineContextMenu],
  );
  const reviewTarget = useMemo(
    () => (reviewActions ? buildSearchReviewTarget(filePath, line, lineIndex) : null),
    [filePath, line, lineIndex, reviewActions],
  );
  const comments = reviewTarget
    ? (reviewActions?.commentsByTarget.get(reviewTarget.key) ?? EMPTY_COMMENTS)
    : EMPTY_COMMENTS;
  const threadState = getInlineReviewThreadState({ reviewTarget, reviewActions });
  const rowStyle = useMemo(
    () => [
      styles.codeLine,
      rowMinHeightStyle,
      // Wrapped, the row grows past one line: the columns stretch to its full
      // height (so the gutter's divider runs the whole way down) and each one
      // holds its own content at the top.
      wrapLines && styles.codeLineWrapped,
      isHovered && styles.codeLineHovered,
    ],
    [isHovered, rowMinHeightStyle, wrapLines],
  );
  // Tokenized on first render and cached against the line, so scrolling back
  // over a result never re-parses it.
  const keyedSegments = useMemo(
    () =>
      getSearchLineSegments(line, highlightExt).map((segment, index) => ({
        key: `${index}-${segment.text}`,
        segment,
      })),
    [highlightExt, line],
  );
  const lineBodyStyle = useMemo(
    () => [styles.lineBody, wrapLines && styles.lineBodyWrapped],
    [wrapLines],
  );
  // Held to one line's height while wrapping, so the box centers on the first
  // wrapped line instead of on the middle of a tall block.
  const selectionSlotStyle = useMemo(
    () => [styles.selectionSlot, wrapLines && inlineUnistylesStyle({ height: codeLineHeight })],
    [codeLineHeight, wrapLines],
  );
  const gutterNumber = <Text style={gutterNumberStyle}>{line.line}</Text>;
  return (
    <>
      <View
        style={rowStyle}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        {showSelection ? (
          <View style={selectionSlotStyle}>
            <SearchSelectionBox
              checked={checked}
              compact
              accessibilityLabel={toggleLabel}
              testID={`${testID}-check`}
              onPress={handleToggle}
            />
          </View>
        ) : null}
        {reviewTarget && reviewActions ? (
          <InlineReviewGutterCell
            reviewTarget={reviewTarget}
            comments={comments}
            isEditorOpen={threadState?.hasEditor ?? false}
            isLineHovered={isHovered}
            lineHeight={codeLineHeight}
            onStartComment={reviewActions.onStartComment}
            style={styles.gutter}
            actionTestID={`${testID}-comment`}
          >
            {gutterNumber}
          </InlineReviewGutterCell>
        ) : (
          <View style={styles.gutter}>{gutterNumber}</View>
        )}
        <Pressable
          accessibilityRole="button"
          onPress={handlePress}
          // @ts-ignore - onContextMenu is web-only and not in RN types.
          onContextMenu={isWeb && onLineContextMenu ? handleContextMenu : undefined}
          style={lineBodyStyle}
          testID={testID}
        >
          <Text style={markerStyle} accessibilityElementsHidden>
            {" "}
          </Text>
          <Text style={codeTextStyle} numberOfLines={wrapLines ? undefined : 1}>
            {keyedSegments.map(({ key, segment }) => (
              <Text
                key={key}
                style={[
                  syntaxTokenStyleFor(segment.style),
                  segment.highlight === "match" && findHighlightStyles.match,
                  segment.highlight === "active" && findHighlightStyles.active,
                ]}
              >
                {segment.text}
              </Text>
            ))}
          </Text>
        </Pressable>
      </View>
      {reviewTarget && reviewActions && threadState ? (
        <InlineReviewThread
          reviewTarget={reviewTarget}
          reviewActions={reviewActions}
          height={threadState.height}
          testID={`${testID}-thread`}
        />
      ) : null}
    </>
  );
});

const styles = StyleSheet.create((theme) => ({
  // The Changes diff well: same surface, same framing, so a result block and a
  // diff block read as the same kind of thing. The frame is drawn by the outer
  // chunks only - a well split across rows must not grow hairlines inside it.
  surface: {
    backgroundColor: theme.colors.surface1,
  },
  surfaceFirstChunk: {
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  surfaceLastChunk: {
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  codeLine: {
    flexDirection: "row",
    alignItems: "center",
    position: "relative",
    backgroundColor: theme.colors.surface1,
  },
  codeLineWrapped: {
    alignItems: "stretch",
  },
  codeLineHovered: {
    backgroundColor: theme.colors.surfaceInteractiveHover,
  },
  selectionSlot: {
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: theme.spacing[1],
  },
  // Geometry copied from the diff viewer's line-number rail, so the two are one
  // rail: same insets, same divider, same metrics.
  gutter: {
    flexShrink: 0,
    flexDirection: "row",
    // The cell stretches to the row (its right border is the rail), but the
    // number itself stays on the first wrapped line.
    alignItems: "flex-start",
    paddingLeft: theme.spacing[1],
    borderRightColor: theme.colors.border,
    borderRightWidth: theme.borderWidth[1],
    position: "relative",
    overflow: "visible",
  },
  gutterNumber: {
    // GUTTER_RIGHT_INSET, inside the cell's width (border-box), so the cell's
    // right edge is the divider itself.
    paddingRight: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    lineHeight: theme.lineHeight.diff,
    textAlign: "right",
  },
  lineBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
  },
  lineBodyWrapped: {
    alignItems: "flex-start",
  },
  // The diff's marker column, carrying a context line's blank marker. It is
  // what puts the code column of a result and the code column of a diff on the
  // same x, and it is the space the gutter's comment button reaches into.
  lineMarker: {
    flexShrink: 0,
    marginLeft: theme.spacing[2],
    width: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    lineHeight: theme.lineHeight.diff,
    textAlign: "left",
  },
  codeText: {
    flex: 1,
    minWidth: 0,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    lineHeight: theme.lineHeight.diff,
    color: theme.colors.foreground,
  },
  // No grammar for this file, so there are no token colours to carry. The diff
  // viewer mutes an unhighlighted context line the same way.
  codeTextPlain: {
    color: theme.colors.foregroundMuted,
  },
  checkbox: {
    width: 16,
    height: 16,
    flexShrink: 0,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.foregroundMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxCompact: {
    width: 13,
    height: 13,
  },
  checkboxChecked: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
}));
