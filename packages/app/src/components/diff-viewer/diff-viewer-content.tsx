// The diff content layer: line rows, the shared gutters, the Structural
// renderer, and the inline review threads. Extracted from the Paseo
// diff-viewer shell, which keeps only the scroll viewport, the props
// surface, and the DiffViewer composition.
import React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { DiffLine } from "@/utils/tool-call-parsers";
import { diffLinePrefix } from "@/utils/diff-highlight";
import { syntaxTokenStyleFor } from "@/styles/syntax-token-styles";
import { contextMenuAnchorFromEvent } from "@/components/ui/context-menu";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import type { ReviewableDiffTarget } from "@/utils/diff-layout";
import {
  getInlineReviewThreadHeight,
  getInlineReviewThreadState,
  InlineReviewThread,
  type InlineReviewActions,
} from "@/review";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { isWeb } from "@/constants/platform";
import { Plus } from "@/components/icons/material-icons";
import type { Theme } from "@/styles/theme";
import { useChangesPreferences } from "@/hooks/use-changes-preferences";
import { useAppSettingValue } from "@/hooks/use-settings";
import {
  createDiffDocumentHunksFromLines,
  diffCode,
  getStructuralDiffUnavailableReason,
  type DiffDocument,
  type DiffPresentation,
} from "@/utils/diff-document";
import {
  buildStructuralRenderPlan,
  type StructuralRenderRow,
} from "@/utils/structural-render-plan";

const selectFormattingDiffHighlights = (settings: { formattingDiffHighlights: boolean }) =>
  settings.formattingDiffHighlights;

const selectStructuralReplacementPresentation = (settings: {
  structuralReplacementPresentation: "new-token" | "before-after";
}) => settings.structuralReplacementPresentation;

export const DiffLineNumberWidthContext = React.createContext(0);

export const DiffCodeTypographyContext =
  React.createContext<React.ComponentProps<typeof Text>["style"]>(undefined);

export const DiffCodeLineHeightContext = React.createContext(0);

export const DiffSyntaxTokensContext = React.createContext<
  ReadonlyMap<DiffLine, NonNullable<DiffLine["tokens"]>>
>(new Map());

export const DiffReviewViewportContext = React.createContext<{
  width: number;
  gutterWidth: number;
  pinToViewport: boolean;
  wrap: boolean;
  onGutterWidthChange?: (width: number) => void;
}>({ width: 0, gutterWidth: 0, pinToViewport: false, wrap: false });

export const DiffReviewActionsContext = React.createContext<{
  targets: ReadonlyMap<
    DiffLine,
    { old: ReviewableDiffTarget | null; new: ReviewableDiffTarget | null }
  >;
  reviewActions?: InlineReviewActions;
  onLineContextMenu?: DiffLineContextMenuHandler;
  leadingGutter?: DiffLeadingGutter;
}>({ targets: new Map() });

const accentForegroundIconColorMapping = (theme: Theme) => ({
  color: theme.colors.accentForeground,
});

const ThemedPlus = withUnistyles(Plus);

export function largestDiffLineNumber(lines: readonly DiffLine[]): number {
  let largest = 1;
  for (const line of lines) {
    largest = Math.max(largest, line.oldLineNumber ?? 0, line.newLineNumber ?? 0);
  }
  return largest;
}

export type DiffLineContextMenuHandler = (input: {
  target: ReviewableDiffTarget;
  x: number;
  y: number;
}) => void;

export interface DiffLeadingGutter {
  width: number;
  renderLine: (line: DiffLine) => React.ReactNode;
}

type StructuralTone = "formatting" | "move";

function StructuralDiffCell({
  line,
  tone,
  showGutter = true,
  showLeadingGutter = true,
  showReviewThread = true,
}: {
  line: DiffLine | null;
  tone?: StructuralTone;
  showGutter?: boolean;
  showLeadingGutter?: boolean;
  showReviewThread?: boolean;
}) {
  const review = React.useContext(DiffReviewActionsContext);
  const { wrap } = React.useContext(DiffReviewViewportContext);
  const displayLine = React.useMemo(
    () =>
      line === null || tone === undefined
        ? line
        : { ...line, type: "context" as const, content: ` ${diffCode(line)}` },
    [line, tone],
  );
  if (!displayLine) return <View style={styles.structuralEmptyCell} />;
  const reviewTarget = line
    ? review.targets.get(line)?.[line.type === "remove" ? "old" : "new"]
    : undefined;
  return (
    <DiffLineRow
      line={displayLine}
      reviewTarget={reviewTarget}
      wrap={wrap}
      structuralTone={tone}
      showGutter={showGutter}
      showLeadingGutter={showLeadingGutter}
      showReviewThread={showReviewThread}
    />
  );
}

function structuralRenderRowSignature(row: StructuralRenderRow): string {
  if (row.kind === "inline-change") {
    return `${row.kind}:${row.before.content}:${row.after.content}`;
  }
  if (row.kind === "paired-change") {
    return `${row.kind}:${row.before?.content ?? ""}:${row.after?.content ?? ""}`;
  }
  return `${row.kind}:${row.line.content}`;
}

function keyedStructuralRows(rows: readonly StructuralRenderRow[]) {
  const occurrences = new Map<string, number>();
  return rows.map((row) => {
    const signature = structuralRenderRowSignature(row);
    const occurrence = occurrences.get(signature) ?? 0;
    occurrences.set(signature, occurrence + 1);
    return { key: `${signature}:${occurrence}`, row };
  });
}

export function StructuralDiff({
  document,
  layout,
}: {
  document: DiffDocument;
  layout: "unified" | "split";
}) {
  const showFormattingChanges = useAppSettingValue(selectFormattingDiffHighlights);
  const replacementPresentation = useAppSettingValue(selectStructuralReplacementPresentation);
  const hunkPlans = React.useMemo(
    () =>
      (document.hunks ?? []).map((hunk) => ({
        key: `${hunk.index}:${hunk.header}`,
        header: hunk.header,
        rows: buildStructuralRenderPlan(
          {
            ...document,
            lines: hunk.lines
              .filter((line) => line.line.type !== "header")
              .map((line) => line.line),
          },
          { showFormattingChanges },
        ),
      })),
    [document, showFormattingChanges],
  );
  const plan = React.useMemo(
    () =>
      hunkPlans.length > 0
        ? { rows: hunkPlans.flatMap((hunk) => hunk.rows.rows) }
        : buildStructuralRenderPlan(document, { showFormattingChanges }),
    [document, hunkPlans, showFormattingChanges],
  );
  const keyedRows = React.useMemo(() => keyedStructuralRows(plan.rows), [plan.rows]);
  return (
    <View style={styles.structuralRows} dataSet={CODE_SURFACE_DATASET} testID="structural-diff">
      {hunkPlans.length > 0
        ? hunkPlans.map((hunkPlan) => (
            <React.Fragment key={hunkPlan.key}>
              <DiffHunkHeader header={hunkPlan.header} />
              {keyedStructuralRows(hunkPlan.rows.rows).map(({ key, row }) => (
                <StructuralRenderRowView
                  key={key}
                  row={row}
                  replacementPresentation={replacementPresentation}
                  layout={layout}
                />
              ))}
            </React.Fragment>
          ))
        : keyedRows.map(({ key, row }) => (
            <StructuralRenderRowView
              key={key}
              row={row}
              replacementPresentation={replacementPresentation}
              layout={layout}
            />
          ))}
    </View>
  );
}

function StructuralDiffPair({
  before,
  after,
  tone,
  layout,
}: {
  before: DiffLine | null;
  after: DiffLine | null;
  tone?: StructuralTone;
  layout: "unified" | "split";
}) {
  const review = React.useContext(DiffReviewActionsContext);
  const hasLeadingGutter = review.leadingGutter !== undefined;
  let commentTarget: ReviewableDiffTarget | null | undefined;
  if (after) {
    commentTarget = review.targets.get(after)?.new;
  } else if (before) {
    commentTarget = review.targets.get(before)?.old;
  }
  // Unified Structural answers the reviewer’s primary question, "what is the
  // resulting code?" For moves and formatting-only edits that means one
  // semantic line at its destination, rather than duplicating unchanged text
  // into an accidental before/after split.
  if (layout === "unified" && tone !== undefined) {
    const result = after ?? before;
    return result ? <StructuralDiffOneSided line={result} tone={tone} /> : null;
  }
  if (tone === "move" || tone === "formatting") {
    return (
      <>
        <View style={styles.structuralSharedGutterRow}>
          <DiffLineNumberGutter
            line={after ?? before}
            oldLineNumber={before?.oldLineNumber}
            newLineNumber={after?.newLineNumber}
            onStartComment={commentTarget}
            onComment={review.reviewActions?.onStartComment}
          />
          <DiffLineMarker type="context" />
          <View style={styles.structuralCell}>
            <StructuralDiffCell
              line={before}
              tone={tone}
              showGutter={false}
              showReviewThread={false}
            />
          </View>
          <View style={[styles.structuralCell, styles.structuralCellDivider]}>
            <StructuralDiffCell
              line={after}
              tone={tone}
              showGutter={false}
              showReviewThread={false}
            />
          </View>
        </View>
        <StructuralPairReviewThreads before={before} after={after} />
      </>
    );
  }
  if (layout === "unified") {
    return (
      <>
        {before ? <StructuralDiffOneSided line={before} tone={tone} /> : null}
        {after ? <StructuralDiffOneSided line={after} tone={tone} /> : null}
      </>
    );
  }
  return (
    <>
      <View style={styles.structuralRow}>
        {hasLeadingGutter ? <DiffLeadingGutterCell line={after ?? before} /> : null}
        <View style={styles.structuralCell}>
          <StructuralDiffCell
            line={before}
            tone={tone}
            showLeadingGutter={!hasLeadingGutter}
            showReviewThread={false}
          />
        </View>
        <View style={[styles.structuralCell, styles.structuralCellDivider]}>
          <StructuralDiffCell
            line={after}
            tone={tone}
            showLeadingGutter={!hasLeadingGutter}
            showReviewThread={false}
          />
        </View>
      </View>
      <StructuralPairReviewThreads before={before} after={after} />
    </>
  );
}

function StructuralPairReviewThreads({
  before,
  after,
}: {
  before: DiffLine | null;
  after: DiffLine | null;
}) {
  const review = React.useContext(DiffReviewActionsContext);
  const beforeReviewTarget = before ? review.targets.get(before)?.old : undefined;
  const afterReviewTarget = after ? review.targets.get(after)?.new : undefined;
  // Each side can own a distinct review thread. Keep both immediately below
  // the paired code row instead of nesting either thread in a code column.
  return (
    <>
      <StructuralPairReviewThread reviewTarget={beforeReviewTarget} />
      {afterReviewTarget?.key !== beforeReviewTarget?.key ? (
        <StructuralPairReviewThread reviewTarget={afterReviewTarget} />
      ) : null}
    </>
  );
}

function StructuralPairReviewThread({
  reviewTarget,
}: {
  reviewTarget: ReviewableDiffTarget | null | undefined;
}) {
  const { reviewActions } = React.useContext(DiffReviewActionsContext);
  const { width, pinToViewport } = React.useContext(DiffReviewViewportContext);
  const state = getInlineReviewThreadState({ reviewTarget, reviewActions });
  if (!reviewTarget || !reviewActions || !state || state.height === 0) return null;

  return (
    <View style={styles.structuralPairReviewThreadRow}>
      <InlineReviewThread
        reviewTarget={reviewTarget}
        reviewActions={reviewActions}
        height={state.height}
        viewportWidth={width || undefined}
        pinToViewport={pinToViewport}
        testID={`review-thread-${reviewTarget.key}`}
      />
    </View>
  );
}

function StructuralDiffOneSided({ line, tone }: { line: DiffLine; tone?: StructuralTone }) {
  return (
    <View style={styles.structuralOneSidedRow}>
      <StructuralDiffCell line={line} tone={tone} />
    </View>
  );
}

function StructuralInlineReplacement({
  before,
  after,
  fragments,
  presentation,
}: {
  before: DiffLine;
  after: DiffLine;
  fragments: Extract<StructuralRenderRow, { kind: "inline-change" }>["spans"];
  presentation: "new-token" | "before-after";
}) {
  const review = React.useContext(DiffReviewActionsContext);
  const { wrap } = React.useContext(DiffReviewViewportContext);
  const syntaxTokens = React.useContext(DiffSyntaxTokensContext);
  const beforeTokens = before.tokens ?? syntaxTokens.get(before);
  const afterTokens = after.tokens ?? syntaxTokens.get(after);
  const addedFragmentStyle = React.useCallback(
    (kind: "added" | "replacement-added") => {
      if (kind === "added" || presentation === "before-after") return styles.inlineAddedText;
      return styles.inlineNewTokenText;
    },
    [presentation],
  );
  let beforeOffset = 0;
  let afterOffset = 0;
  return (
    <>
      <DiffLineFrame
        style={styles.structuralInlineCodeRow}
        reviewTarget={review.targets.get(after)?.new ?? review.targets.get(before)?.old}
      >
        <DiffLineNumberGutter
          line={after}
          oldLineNumber={before.oldLineNumber}
          newLineNumber={after.newLineNumber}
          onStartComment={
            review.targets.get(after)?.new ?? review.targets.get(before)?.old ?? undefined
          }
          onComment={review.reviewActions?.onStartComment}
        />
        <DiffLineMarker type="context" />
        <Text style={wrap ? LINE_TEXT_WRAP_STYLE : styles.lineText}>
          {fragments.map((fragment) => {
            const key = `${fragment.kind}:${fragment.text}`;
            if (fragment.kind === "shared") {
              const start = afterOffset;
              beforeOffset += fragment.text.length;
              afterOffset += fragment.text.length;
              return (
                <DiffSyntaxFragment
                  key={key}
                  tokens={afterTokens}
                  start={start}
                  text={fragment.text}
                />
              );
            }
            if (fragment.kind === "removed") {
              const start = beforeOffset;
              beforeOffset += fragment.text.length;
              return presentation === "before-after" ? (
                <DiffSyntaxFragment
                  key={key}
                  tokens={beforeTokens}
                  start={start}
                  text={fragment.text}
                  foregroundOverride={styles.inlineRemovedText}
                />
              ) : null;
            }
            const start = afterOffset;
            afterOffset += fragment.text.length;
            return (
              <DiffSyntaxFragment
                key={key}
                tokens={afterTokens}
                start={start}
                text={fragment.text}
                foregroundOverride={addedFragmentStyle(fragment.kind)}
              />
            );
          })}
        </Text>
      </DiffLineFrame>
      <StructuralReviewThread reviewTarget={review.targets.get(after)?.new} />
    </>
  );
}

/**
 * Structural replacements retain the normal language token colors for their
 * unchanged portions. The semantic diff color is deliberately layered last so
 * only the changed span becomes purple or explicit red/green.
 */
function DiffSyntaxFragment({
  tokens,
  start,
  text,
  foregroundOverride,
}: {
  tokens: DiffLine["tokens"];
  start: number;
  text: string;
  foregroundOverride?: React.ComponentProps<typeof Text>["style"];
}) {
  const pieces = React.useMemo(() => {
    if (!tokens || text.length === 0) return null;
    const end = start + text.length;
    let cursor = 0;
    const result: Array<{ key: string; text: string; style: string | null | undefined }> = [];
    for (const [index, token] of tokens.entries()) {
      const tokenStart = cursor;
      const tokenEnd = tokenStart + token.text.length;
      cursor = tokenEnd;
      const sliceStart = Math.max(start, tokenStart);
      const sliceEnd = Math.min(end, tokenEnd);
      if (sliceStart >= sliceEnd) continue;
      result.push({
        key: `${index}:${token.text}:${sliceStart - tokenStart}`,
        text: token.text.slice(sliceStart - tokenStart, sliceEnd - tokenStart),
        style: token.style,
      });
    }
    return result;
  }, [start, text.length, tokens]);
  if (!pieces || pieces.length === 0) {
    return <Text style={foregroundOverride}>{text}</Text>;
  }
  return (
    <>
      {pieces.map((piece) => (
        <Text
          key={piece.key}
          style={[piece.style ? syntaxTokenStyleFor(piece.style) : undefined, foregroundOverride]}
        >
          {piece.text}
        </Text>
      ))}
    </>
  );
}

function DiffLineNumberGutter({
  line,
  showLeadingGutter = true,
  oldLineNumber,
  newLineNumber,
  lineType,
  onStartComment,
  onComment,
}: {
  line?: DiffLine | null;
  showLeadingGutter?: boolean;
  oldLineNumber?: number;
  newLineNumber?: number;
  lineType?: DiffLine["type"];
  onStartComment?: ReviewableDiffTarget | null;
  onComment?: (target: ReviewableDiffTarget) => void;
}) {
  const cellWidth = React.useContext(DiffLineNumberWidthContext);
  const { leadingGutter } = React.useContext(DiffReviewActionsContext);
  const typography = React.useContext(DiffCodeTypographyContext);
  const lineHeight = React.useContext(DiffCodeLineHeightContext);
  const [isHovered, setIsHovered] = React.useState(false);
  const handleHoverIn = React.useCallback(() => setIsHovered(true), []);
  const handleHoverOut = React.useCallback(() => setIsHovered(false), []);
  const handlePress = React.useCallback(() => {
    if (onStartComment && onComment) onComment(onStartComment);
  }, [onComment, onStartComment]);
  const numberWidthStyle = inlineUnistylesStyle({ width: cellWidth });
  const actionIconSize = Math.min(22, lineHeight || 22);
  const actionIconGlyphSize = Math.min(16, Math.max(actionIconSize - 6, 10));
  const actionIconStyle = React.useMemo(
    () => [
      styles.gutterCommentAffordance,
      inlineUnistylesStyle({
        width: actionIconSize,
        height: actionIconSize,
        top: Math.floor(((lineHeight || actionIconSize) - actionIconSize) / 2),
      }),
    ],
    [actionIconSize, lineHeight],
  );
  return (
    <>
      {showLeadingGutter && leadingGutter ? <DiffLeadingGutterCell line={line ?? null} /> : null}
      <Pressable
        style={[
          styles.lineNumberGutter,
          lineType === "add" && styles.addLineNumberGutter,
          lineType === "remove" && styles.removeLineNumberGutter,
        ]}
        onHoverIn={handleHoverIn}
        onHoverOut={handleHoverOut}
        onPress={onStartComment && onComment ? handlePress : undefined}
        accessibilityRole={onStartComment && onComment ? "button" : undefined}
      >
        <Text
          style={[
            styles.lineNumberText,
            typography,
            numberWidthStyle,
            lineType === "remove" && styles.removeLineNumberText,
          ]}
        >
          {oldLineNumber ?? ""}
        </Text>
        <Text
          style={[
            styles.lineNumberText,
            typography,
            numberWidthStyle,
            lineType === "add" && styles.addLineNumberText,
          ]}
        >
          {newLineNumber ?? ""}
        </Text>
        {isHovered && onStartComment && onComment ? (
          <View style={actionIconStyle}>
            <ThemedPlus size={actionIconGlyphSize} uniProps={accentForegroundIconColorMapping} />
          </View>
        ) : null}
      </Pressable>
    </>
  );
}

function DiffHunkHeader({ header }: { header: string }) {
  const typography = React.useContext(DiffCodeTypographyContext);
  return (
    <View style={styles.hunkHeaderRow}>
      <DiffHunkGutter />
      <Text style={[styles.hunkHeaderText, typography]}>{header}</Text>
    </View>
  );
}

function DiffHunkGutter() {
  const cellWidth = React.useContext(DiffLineNumberWidthContext);
  const { leadingGutter } = React.useContext(DiffReviewActionsContext);
  const numberWidthStyle = inlineUnistylesStyle({ width: cellWidth });
  return (
    <>
      {leadingGutter ? <DiffLeadingGutterCell line={null} /> : null}
      <View style={styles.lineNumberGutter}>
        <View style={numberWidthStyle} />
        <View style={numberWidthStyle} />
      </View>
      <Text style={styles.lineMarker}> </Text>
    </>
  );
}

function DiffLeadingGutterCell({ line }: { line: DiffLine | null }) {
  const { leadingGutter } = React.useContext(DiffReviewActionsContext);
  if (!leadingGutter) return null;
  return (
    <View style={[styles.leadingGutter, inlineUnistylesStyle({ width: leadingGutter.width })]}>
      {line ? leadingGutter.renderLine(line) : null}
    </View>
  );
}

/**
 * Review threads begin immediately after the numbered rail. This intentionally
 * does not reserve the diff marker column: the established Changes review
 * surface uses that geometry, and it keeps a saved thread aligned with its
 * editor instead of shifting it one marker-width to the right.
 */
function DiffReviewGutterSpacer() {
  const cellWidth = React.useContext(DiffLineNumberWidthContext);
  const { leadingGutter } = React.useContext(DiffReviewActionsContext);
  const { onGutterWidthChange } = React.useContext(DiffReviewViewportContext);
  const handleLayout = React.useCallback(
    (event: { nativeEvent: { layout: { width: number } } }) =>
      onGutterWidthChange?.(event.nativeEvent.layout.width),
    [onGutterWidthChange],
  );
  const numberWidthStyle = inlineUnistylesStyle({ width: cellWidth });
  return (
    <View style={styles.reviewGutterRail} onLayout={handleLayout}>
      {leadingGutter ? <DiffLeadingGutterCell line={null} /> : null}
      <View style={styles.lineNumberGutter}>
        <View style={numberWidthStyle} />
        <View style={numberWidthStyle} />
      </View>
    </View>
  );
}

function DiffLineMarker({ type }: { type: DiffLine["type"] }) {
  const typography = React.useContext(DiffCodeTypographyContext);
  return (
    <Text
      style={[
        styles.lineMarker,
        typography,
        type === "add" && styles.addMarker,
        type === "remove" && styles.removeMarker,
      ]}
      accessibilityElementsHidden
    >
      {diffLinePrefix({ type, content: "" })}
    </Text>
  );
}

function StructuralRenderRowView({
  row,
  replacementPresentation,
  layout,
}: {
  row: StructuralRenderRow;
  replacementPresentation: "new-token" | "before-after";
  layout: "unified" | "split";
}) {
  if (row.kind === "header") {
    return (
      <View style={styles.structuralHeader}>
        <Text style={styles.structuralHeaderText}>{row.line.content}</Text>
      </View>
    );
  }
  if (row.kind === "line") {
    return <StructuralDiffOneSided line={row.line} tone={row.tone} />;
  }
  if (row.kind === "inline-change") {
    if (layout === "split") {
      return <StructuralDiffPair before={row.before} after={row.after} layout={layout} />;
    }
    return (
      <StructuralInlineReplacement
        before={row.before}
        after={row.after}
        fragments={row.spans}
        presentation={replacementPresentation}
      />
    );
  }
  return (
    <StructuralDiffPair before={row.before} after={row.after} tone={row.tone} layout={layout} />
  );
}

export function useDiffPresentation(input: {
  diffLines: readonly DiffLine[];
  document?: DiffDocument;
  filePath: string | null | undefined;
  source: DiffDocument["source"];
  beforeSource: string | null | undefined;
  afterSource: string | null | undefined;
  presentation: DiffPresentation | undefined;
}) {
  const {
    diffLines,
    document: suppliedDocument,
    filePath,
    source,
    beforeSource,
    afterSource,
    presentation,
  } = input;
  const { preferences } = useChangesPreferences();
  const document = React.useMemo<DiffDocument>(
    () =>
      suppliedDocument ?? {
        lines: diffLines,
        filePath,
        source,
        beforeSource,
        afterSource,
        hunks: createDiffDocumentHunksFromLines(diffLines),
      },
    [afterSource, beforeSource, diffLines, filePath, source, suppliedDocument],
  );
  const requestedPresentation = presentation ?? preferences.presentation;
  const structuralUnavailableReason = React.useMemo(
    () => getStructuralDiffUnavailableReason(document),
    [document],
  );
  const effectivePresentation: DiffPresentation =
    requestedPresentation === "structural" && structuralUnavailableReason === null
      ? "structural"
      : "line";
  return {
    document,
    effectivePresentation,
  };
}

export function DiffLineRow({
  line,
  reviewTarget,
  wrap,
  structuralTone,
  showGutter = true,
  showLeadingGutter = true,
  showReviewThread = true,
}: {
  line: DiffLine;
  reviewTarget?: ReviewableDiffTarget | null;
  wrap: boolean;
  structuralTone?: StructuralTone;
  showGutter?: boolean;
  showLeadingGutter?: boolean;
  showReviewThread?: boolean;
}) {
  const review = React.useContext(DiffReviewActionsContext);
  const syntaxTokens = React.useContext(DiffSyntaxTokensContext);
  const tokens = line.tokens ?? syntaxTokens.get(line);
  const target = reviewTarget ?? review.targets.get(line)?.[line.type === "remove" ? "old" : "new"];
  const typography = React.useContext(DiffCodeTypographyContext);
  const baseTextStyle = React.useMemo(
    () => (wrap ? [LINE_TEXT_WRAP_STYLE, typography] : [styles.lineText, typography]),
    [typography, wrap],
  );
  const lineContainerStyle = React.useMemo(
    () => [
      styles.line,
      line.type === "header" && styles.headerLine,
      line.type === "add" && styles.addLine,
      line.type === "remove" && styles.removeLine,
      line.type === "context" && styles.contextLine,
      structuralTone === "formatting" && styles.formattingLine,
    ],
    [line.type, structuralTone],
  );
  const plainLineTextStyle = React.useMemo(
    () => [
      baseTextStyle,
      line.type === "header" && styles.headerText,
      line.type === "add" && styles.addText,
      line.type === "remove" && styles.removeText,
      line.type === "context" && styles.contextText,
      structuralTone === "move" && styles.movedText,
    ],
    [line.type, baseTextStyle, structuralTone],
  );
  if (line.type === "header") {
    return (
      <View style={styles.hunkHeaderRow}>
        <DiffHunkGutter />
        <Text style={[styles.hunkHeaderText, typography]}>{line.content}</Text>
      </View>
    );
  }

  if (tokens) {
    return (
      <>
        <DiffLineFrame style={lineContainerStyle} reviewTarget={target}>
          {showGutter ? (
            <DiffLineNumberGutter
              line={line}
              showLeadingGutter={showLeadingGutter}
              oldLineNumber={line.oldLineNumber}
              newLineNumber={line.newLineNumber}
              lineType={line.type}
              onStartComment={target}
              onComment={review.reviewActions?.onStartComment}
            />
          ) : null}
          {showGutter ? <DiffLineMarker type={line.type} /> : null}
          <Text style={baseTextStyle}>
            <DiffTokens
              tokens={tokens}
              foregroundOverride={structuralTone === "move" ? styles.movedText : undefined}
            />
          </Text>
        </DiffLineFrame>
        <DiffLineReviewThread reviewTarget={target} show={showReviewThread} />
      </>
    );
  }

  return (
    <>
      <DiffLineFrame style={lineContainerStyle} reviewTarget={target}>
        {showGutter ? (
          <DiffLineNumberGutter
            line={line}
            showLeadingGutter={showLeadingGutter}
            oldLineNumber={line.oldLineNumber}
            newLineNumber={line.newLineNumber}
            lineType={line.type}
            onStartComment={target}
            onComment={review.reviewActions?.onStartComment}
          />
        ) : null}
        {showGutter ? <DiffLineMarker type={line.type} /> : null}
        {line.segments ? (
          <Text style={baseTextStyle}>
            {line.segments.map((segment) => (
              <DiffSegment
                key={`${segment.changed ? "c" : "u"}:${segment.text}`}
                segment={segment}
                lineType={line.type}
              />
            ))}
          </Text>
        ) : (
          <Text style={plainLineTextStyle}>{diffCode(line)}</Text>
        )}
      </DiffLineFrame>
      <DiffLineReviewThread reviewTarget={target} show={showReviewThread} />
    </>
  );
}

function DiffLineReviewThread({
  reviewTarget,
  show,
}: {
  reviewTarget: ReviewableDiffTarget | null | undefined;
  show: boolean;
}) {
  return show ? <StructuralReviewThread reviewTarget={reviewTarget} /> : null;
}

function DiffLineFrame({
  style,
  reviewTarget,
  children,
}: {
  style: React.ComponentProps<typeof View>["style"];
  reviewTarget: ReviewableDiffTarget | null | undefined;
  children: React.ReactNode;
}) {
  const { onLineContextMenu } = React.useContext(DiffReviewActionsContext);
  const handleContextMenu = React.useCallback(
    (event: unknown) => {
      if (!reviewTarget || !onLineContextMenu) return;
      const anchor = contextMenuAnchorFromEvent(event);
      if (anchor) onLineContextMenu({ target: reviewTarget, x: anchor.x, y: anchor.y });
    },
    [onLineContextMenu, reviewTarget],
  );
  if (isWeb && reviewTarget && onLineContextMenu) {
    return (
      <Pressable
        // @ts-ignore React Native exposes this web event without a matching type.
        onContextMenu={handleContextMenu}
        style={style}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={style}>{children}</View>;
}

function StructuralReviewThread({
  reviewTarget,
}: {
  reviewTarget: ReviewableDiffTarget | null | undefined;
}) {
  const { reviewActions } = React.useContext(DiffReviewActionsContext);
  const { width, gutterWidth, pinToViewport } = React.useContext(DiffReviewViewportContext);
  const state = getInlineReviewThreadState({ reviewTarget, reviewActions });
  const [measuredThreadHeight, setMeasuredThreadHeight] = React.useState(0);
  React.useEffect(() => {
    setMeasuredThreadHeight(0);
  }, [state?.height, state?.editingCommentId]);
  const handleThreadHeightChange = React.useCallback(
    (height: number) => setMeasuredThreadHeight((current) => Math.max(current, height)),
    [],
  );
  const threadHeight = getInlineReviewThreadHeight(state?.height ?? 0, measuredThreadHeight);
  const rowStyle = [
    styles.structuralReviewThreadRow,
    inlineUnistylesStyle({ minHeight: threadHeight }),
  ];
  if (!reviewTarget || !reviewActions || !state || state.height === 0) return null;
  const viewportWidth = width > gutterWidth ? width - gutterWidth : undefined;
  return (
    <View style={rowStyle}>
      <DiffReviewGutterSpacer />
      <InlineReviewThread
        reviewTarget={reviewTarget}
        reviewActions={reviewActions}
        height={threadHeight}
        onHeightChange={handleThreadHeightChange}
        viewportWidth={viewportWidth}
        viewportLeft={gutterWidth}
        pinToViewport={pinToViewport}
        testID={`review-thread-${reviewTarget.key}`}
      />
    </View>
  );
}

function DiffTokens({
  tokens,
  foregroundOverride,
}: {
  tokens: NonNullable<DiffLine["tokens"]>;
  foregroundOverride?: React.ComponentProps<typeof Text>["style"];
}) {
  const keyed = React.useMemo(
    () => tokens.map((token, index) => ({ key: `${index}-${token.text}`, token })),
    [tokens],
  );
  return (
    <>
      {keyed.map(({ key, token }) => (
        <Text
          key={key}
          style={[token.style ? syntaxTokenStyleFor(token.style) : undefined, foregroundOverride]}
        >
          {token.text}
        </Text>
      ))}
    </>
  );
}

function DiffSegment({
  segment,
  lineType,
}: {
  segment: NonNullable<DiffLine["segments"]>[number];
  lineType: DiffLine["type"];
}) {
  const segmentStyle = React.useMemo(
    () => [
      lineType === "add" ? styles.addText : styles.removeText,
      segment.changed && (lineType === "add" ? styles.addHighlight : styles.removeHighlight),
    ],
    [lineType, segment.changed],
  );
  return <Text style={segmentStyle}>{segment.text}</Text>;
}

const styles = StyleSheet.create((theme) => {
  return {
    line: {
      minWidth: "100%",
      minHeight: theme.lineHeight.diff,
      flexDirection: "row",
      paddingHorizontal: 0,
      paddingVertical: 0,
    },
    lineNumberGutter: {
      flexDirection: "row",
      flexShrink: 0,
      // Keep the two coordinates visually paired, while leaving a compact
      // cushion on both outer edges of the shared gutter.
      gap: theme.spacing[1.5],
      paddingLeft: theme.spacing[1],
      paddingRight: theme.spacing[2],
      borderRightColor: theme.colors.border,
      borderRightWidth: theme.borderWidth[1],
      position: "relative",
      overflow: "visible",
    },
    // Surface-owned context, such as History blame, is a stable rail rather
    // than part of an added/removed line. It stays on the editor background
    // and has its own divider before the numbered diff gutter.
    leadingGutter: {
      flexShrink: 0,
      alignSelf: "stretch",
      backgroundColor: theme.colors.surface1,
      borderRightColor: theme.colors.border,
      borderRightWidth: theme.borderWidth[1],
    },
    reviewGutterRail: {
      flexDirection: "row",
      flexShrink: 0,
    },
    addLineNumberGutter: {
      backgroundColor: theme.colors.syntax.diffAdded,
    },
    removeLineNumberGutter: {
      backgroundColor: theme.colors.syntax.diffRemoved,
    },
    lineNumberText: {
      color: theme.colors.foregroundMuted,
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
      lineHeight: theme.lineHeight.diff,
      textAlign: "right",
    },
    addLineNumberText: {
      color: theme.colors.syntax.diffAddedForeground,
    },
    removeLineNumberText: {
      color: theme.colors.syntax.diffRemovedForeground,
    },
    gutterCommentAffordance: {
      position: "absolute",
      // Centre the control on the gutter rail, exactly like the established
      // review gutter. The sign spacing is tuned separately.
      right: -10,
      width: 22,
      height: 22,
      backgroundColor: theme.colors.accent,
      borderRadius: theme.borderRadius.md,
      alignItems: "center",
      justifyContent: "center",
      zIndex: 10,
      elevation: 10,
    },
    lineMarker: {
      flexShrink: 0,
      // The sign (or its context-space) begins 8px after the gutter rail and
      // occupies one mono glyph. Code
      // follows immediately, so all three line kinds share one code column.
      marginLeft: theme.spacing[2],
      width: theme.spacing[2],
      color: theme.colors.foregroundMuted,
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
      lineHeight: theme.lineHeight.diff,
      textAlign: "left",
    },
    addMarker: {
      color: theme.colors.syntax.diffAddedForeground,
    },
    removeMarker: {
      color: theme.colors.syntax.diffRemovedForeground,
    },
    hunkHeaderRow: {
      backgroundColor: theme.colors.surface2,
      flexDirection: "row",
      minHeight: theme.lineHeight.diff,
    },
    hunkHeaderText: {
      color: theme.colors.foregroundMuted,
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
      lineHeight: theme.lineHeight.diff,
    },
    lineText: {
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
      lineHeight: theme.lineHeight.diff,
      color: theme.colors.foreground,
      ...(isWeb
        ? {
            whiteSpace: "pre",
            overflowWrap: "normal",
          }
        : null),
    },
    // Layered over lineText when "Wrap long lines" is on: web needs the
    // explicit pre-wrap (lineText forces `pre`); native Text soft-wraps by
    // itself once the horizontal ScrollView is gone.
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
    headerLine: {
      backgroundColor: theme.colors.surface1,
    },
    headerText: {
      color: theme.colors.foregroundMuted,
    },
    addLine: {
      backgroundColor: theme.colors.syntax.diffAdded,
    },
    addText: {
      color: theme.colors.foreground,
    },
    removeLine: {
      backgroundColor: theme.colors.syntax.diffRemoved,
    },
    removeText: {
      color: theme.colors.foreground,
    },
    addHighlight: {
      backgroundColor: theme.colors.syntax.diffAddedEmphasis,
    },
    removeHighlight: {
      backgroundColor: theme.colors.syntax.diffRemovedEmphasis,
    },
    contextLine: {
      backgroundColor: theme.colors.surface1,
    },
    contextText: {
      color: theme.colors.foregroundMuted,
    },
    formattingLine: {
      backgroundColor: theme.colors.syntax.diffFormatting,
    },
    movedText: {
      color: theme.colors.syntax.diffMoved,
    },
    inlineNewTokenText: {
      color: theme.colors.syntax.diffMoved,
    },
    inlineRemovedText: {
      color: theme.colors.statusDanger,
      textDecorationLine: "line-through",
    },
    inlineAddedText: {
      color: theme.colors.statusSuccess,
    },
    structuralRows: {
      backgroundColor: theme.colors.surface1,
    },
    structuralRow: {
      flexDirection: "row",
      alignItems: "stretch",
    },
    structuralSharedGutterRow: {
      flexDirection: "row",
      alignItems: "stretch",
      minWidth: "100%",
    },
    structuralSharedRow: {
      backgroundColor: theme.colors.surface2,
    },
    structuralOneSidedRow: {
      flexDirection: "column",
      minWidth: 0,
    },
    structuralInlineCodeRow: {
      flexDirection: "row",
      minWidth: "100%",
    },
    structuralReviewThreadRow: {
      flexDirection: "row",
      minWidth: 0,
    },
    structuralPairReviewThreadRow: {
      alignSelf: "stretch",
      minWidth: "100%",
    },
    structuralCell: {
      flex: 1,
      minWidth: 0,
    },
    structuralCellDivider: {
      borderLeftWidth: theme.borderWidth[1],
      borderLeftColor: theme.colors.border,
    },
    structuralEmptyCell: {
      flex: 1,
      minHeight: theme.lineHeight.diff,
      backgroundColor: theme.colors.surfaceDiffEmpty,
    },
    structuralHeader: {
      backgroundColor: theme.colors.surface2,
      paddingHorizontal: theme.spacing[3],
      paddingVertical: theme.spacing[1],
    },
    structuralHeaderText: {
      color: theme.colors.foregroundMuted,
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
    },
  };
});

const LINE_TEXT_WRAP_STYLE = [styles.lineText, styles.lineTextWrap];
