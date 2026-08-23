import { memo, useCallback, useMemo, useState, type ComponentProps } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { isLanguageSupported } from "@otto-code/highlight";
import { Check } from "@/components/icons/material-icons";
import { lineNumberGutterWidth } from "@/components/code-insets";
import {
  resolveSearchLineTokens,
  type SearchDisplayLine,
} from "@/components/project-search-code-lines";
import { splitTokensForMatches, type MatchedTokenSegment } from "@/components/file-preview-find";
import { findHighlightStyles } from "@/components/find-highlight-styles";
import { isWeb } from "@/constants/platform";
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
import { extensionFromPath, tokenizeToLines } from "@/utils/highlight-cache";
import type { ReviewDraftComment } from "@/review";

const accentForegroundIconColorMapping = (theme: Theme) => ({
  color: theme.colors.accentForeground,
});
const ThemedCheck = withUnistyles(Check);

const selectCodeFontSize = (settings: { codeFontSize: number }) => settings.codeFontSize;

const EMPTY_SEGMENTS: MatchedTokenSegment[] = [];
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
  /** Replace mode: each line carries the selection for its own matches. */
  showSelection: boolean;
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
}

/**
 * A file's matches as a code well: the Changes diff surface without the diff -
 * the same rail, marker column, and code metrics, with the hit lit up by the
 * shared find highlight.
 */
export const SearchCodeBlock = memo(function SearchCodeBlock({
  filePath,
  lines,
  showSelection,
  isLineChecked,
  toggleLabel,
  onToggleLine,
  onPressLine,
  onLineContextMenu,
  reviewActions,
  testIDPrefix,
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
    let maxLine = 0;
    for (const line of lines) {
      maxLine = Math.max(maxLine, line.line);
    }
    return lineNumberGutterWidth(maxLine, codeFontSize, 0, 1);
  }, [codeFontSize, lines]);
  const gutterNumberStyle = useMemo(
    () => [styles.gutterNumber, typography, inlineUnistylesStyle({ width: gutterWidth })],
    [gutterWidth, typography],
  );
  const markerStyle = useMemo(() => [styles.lineMarker, typography], [typography]);
  const rowMinHeightStyle = useMemo(
    () => inlineUnistylesStyle({ minHeight: codeLineHeight }),
    [codeLineHeight],
  );

  // Each preview line is tokenized on its own. They are disjoint lines lifted
  // out of a file, so joining them would let an unterminated string or comment
  // on one bleed into the next. The hits are then cut out of those tokens by
  // the same splitter the read-only preview's find uses.
  const { segmentsByLine, isHighlighted } = useMemo(() => {
    const ext = extensionFromPath(filePath);
    const supported = ext !== null && isLanguageSupported(`x.${ext}`);
    return {
      isHighlighted: supported,
      segmentsByLine: lines.map((line) =>
        splitTokensForMatches(
          resolveSearchLineTokens(
            line.text,
            supported ? tokenizeToLines(line.text, ext)?.[0] : null,
          ),
          line.ranges,
        ),
      ),
    };
  }, [filePath, lines]);

  const codeTextStyle = useMemo(
    () => [styles.codeText, !isHighlighted && styles.codeTextPlain, typography],
    [isHighlighted, typography],
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

  return (
    <View style={styles.surface} dataSet={CODE_SURFACE_DATASET}>
      {lines.map((line, index) => (
        <SearchCodeLine
          key={line.key}
          filePath={filePath}
          line={line}
          lineIndex={index}
          segments={segmentsByLine[index] ?? EMPTY_SEGMENTS}
          showSelection={showSelection}
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
          testID={`${testIDPrefix}-${index}`}
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
  segments,
  showSelection,
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
  segments: readonly MatchedTokenSegment[];
  showSelection: boolean;
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
    () => [styles.codeLine, rowMinHeightStyle, isHovered && styles.codeLineHovered],
    [isHovered, rowMinHeightStyle],
  );
  const keyedSegments = useMemo(
    () => segments.map((segment, index) => ({ key: `${index}-${segment.text}`, segment })),
    [segments],
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
          <View style={styles.selectionSlot}>
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
          style={styles.lineBody}
          testID={testID}
        >
          <Text style={markerStyle} accessibilityElementsHidden>
            {" "}
          </Text>
          <Text style={codeTextStyle} numberOfLines={1}>
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
  // diff block read as the same kind of thing.
  surface: {
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  codeLine: {
    flexDirection: "row",
    alignItems: "center",
    position: "relative",
    backgroundColor: theme.colors.surface1,
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
    paddingLeft: theme.spacing[1],
    paddingRight: theme.spacing[2],
    borderRightColor: theme.colors.border,
    borderRightWidth: theme.borderWidth[1],
    position: "relative",
    overflow: "visible",
  },
  gutterNumber: {
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
    ...(isWeb ? { whiteSpace: "pre", overflowWrap: "normal" } : null),
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
