import React from "react";
import { useTranslation } from "react-i18next";
import { View, Text, ScrollView as RNScrollView } from "react-native";
import { ScrollView as GHScrollView } from "react-native-gesture-handler";
import { StyleSheet } from "react-native-unistyles";
import type { DiffLine } from "@/utils/tool-call-parsers";
import { highlightDiffLines } from "@/utils/diff-highlight";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { lineNumberGutterWidth } from "./code-insets";
import type { ReviewableDiffTarget } from "@/utils/diff-layout";
import { type InlineReviewActions } from "@/review";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { isWeb } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useAppSettingValue, useAppSettings } from "@/hooks/use-settings";
import { type DiffDocument, type DiffPresentation } from "@/utils/diff-document";
import {
  DiffCodeLineHeightContext,
  DiffCodeTypographyContext,
  DiffLineNumberWidthContext,
  DiffLineRow,
  DiffReviewActionsContext,
  DiffReviewViewportContext,
  DiffSyntaxTokensContext,
  StructuralDiff,
  largestDiffLineNumber,
  useDiffPresentation,
  type DiffLeadingGutter,
  type DiffLineContextMenuHandler,
} from "./diff-viewer/diff-viewer-content";

// Back-compat: review surfaces import these types from this file.
export type {
  DiffLineContextMenuHandler,
  DiffLeadingGutter,
} from "./diff-viewer/diff-viewer-content";

const ScrollView = isWeb ? RNScrollView : GHScrollView;

const selectCodeFontSize = (settings: { codeFontSize: number }) => settings.codeFontSize;

interface DiffViewerProps {
  diffLines: readonly DiffLine[];
  /**
   * Rich review surfaces provide their canonical document so Structural keeps
   * native hunk boundaries, syntax tokens, coordinates, and review metadata.
   */
  document?: DiffDocument;
  /** Existing review surfaces retain their native comment state and composer. */
  reviewActions?: InlineReviewActions;
  /** Web review panes can continue to route a right-click through their shared menu. */
  onLineContextMenu?: DiffLineContextMenuHandler;
  /** Optional surface-owned context immediately left of the shared number rail. */
  leadingGutter?: DiffLeadingGutter;
  /** Enables syntax-aware structural alignment when a source path is known. */
  filePath?: string | null;
  source?: DiffDocument["source"];
  /** Complete source snapshots enable parser-safe Structural eligibility. */
  beforeSource?: string | null;
  afterSource?: string | null;
  /** Controlled local choice for richer parent review panes. */
  presentation?: DiffPresentation;
  /**
   * The Changes surface's unified/side-by-side choice. Structural keeps its
   * semantic pairing in either layout, but honors an explicit split choice
   * rather than silently replacing it with the unified presentation.
   */
  layout?: "unified" | "split";
  maxHeight?: number;
  emptyLabel?: string;
  fillAvailableHeight?: boolean;
  /** `top` / `bottom` are for hosts that own the opposite separator. */
  frame?: "full" | "top" | "bottom" | "none";
  /**
   * Render inside a parent document scroller. Hunk review needs one vertical
   * reading flow, not a stack of independently scrolling mini-diffs.
   */
  embedded?: boolean;
  // "Wrap long lines" appearance setting: soft-wrap long diff lines instead of
  // horizontal scrolling. Visual only - selection/copy still yields the
  // original unwrapped text.
  wrap?: boolean;
}

export function DiffViewer({
  diffLines,
  document,
  reviewActions: suppliedReviewActions,
  onLineContextMenu,
  leadingGutter,
  filePath,
  source = "patch",
  beforeSource,
  afterSource,
  presentation,
  layout,
  maxHeight,
  emptyLabel,
  fillAvailableHeight = false,
  frame = "full",
  embedded = false,
  wrap,
}: DiffViewerProps) {
  const { t } = useTranslation();
  const [scrollViewWidth, setScrollViewWidth] = React.useState(0);
  const [surfaceWidth, setSurfaceWidth] = React.useState(0);
  const [reviewGutterWidth, setReviewGutterWidth] = React.useState(0);
  const codeFontSize = useAppSettingValue(selectCodeFontSize);
  const { settings } = useAppSettings();
  // Changes owns wrapping. A shared viewer must never inherit that surface's
  // preference merely because it happens to render a diff.
  const resolvedWrap = wrap ?? false;
  // Split is owned by the full Changes viewer. Other diff surfaces use the
  // shared Structural renderer in its compact unified presentation unless
  // they later introduce and explicitly pass their own layout control.
  const resolvedLayout = layout ?? "unified";
  const codeLineHeight = Math.round(codeFontSize * 1.5);
  const codeTypography = React.useMemo(() => {
    const monoFontFamily = settings.monoFontFamily.trim();
    return {
      fontSize: codeFontSize,
      lineHeight: codeLineHeight,
      ...(monoFontFamily ? { fontFamily: monoFontFamily } : null),
    };
  }, [codeFontSize, codeLineHeight, settings.monoFontFamily]);
  const lineNumberCellWidth = React.useMemo(
    () =>
      lineNumberGutterWidth(
        largestDiffLineNumber(document?.lines ?? diffLines),
        codeFontSize,
        0,
        1,
      ),
    [codeFontSize, diffLines, document?.lines],
  );
  const diffPresentation = useDiffPresentation({
    diffLines,
    document,
    filePath,
    source,
    beforeSource,
    afterSource,
    presentation,
  });
  const syntaxTokens = React.useMemo(() => {
    const originalLines = diffPresentation.document.lines;
    const highlightedLines = highlightDiffLines(
      [...originalLines],
      diffPresentation.document.filePath,
    );
    const mapped = new Map<DiffLine, NonNullable<DiffLine["tokens"]>>();
    highlightedLines.forEach((line, index) => {
      const original = originalLines[index];
      if (original && !original.tokens && line.tokens) mapped.set(original, line.tokens);
    });
    return mapped;
  }, [diffPresentation.document.filePath, diffPresentation.document.lines]);
  const reviewActions = React.useMemo(() => {
    const targets = new Map<
      DiffLine,
      { old: ReviewableDiffTarget | null; new: ReviewableDiffTarget | null }
    >();
    for (const hunk of diffPresentation.document.hunks ?? []) {
      for (const line of hunk.lines) {
        targets.set(line.line, { old: line.oldReviewTarget, new: line.newReviewTarget });
      }
    }
    return { targets, reviewActions: suppliedReviewActions, onLineContextMenu, leadingGutter };
  }, [diffPresentation.document.hunks, leadingGutter, onLineContextMenu, suppliedReviewActions]);
  const resolvedEmptyLabel = emptyLabel ?? t("diffViewer.empty");
  const isCompact = useIsCompactFormFactor();
  const showDesktopWebScrollbar = isWeb && !isCompact;
  const verticalScrollRef = React.useRef<RNScrollView>(null);
  const verticalScrollbar = useWebScrollViewScrollbar(verticalScrollRef, {
    enabled: showDesktopWebScrollbar,
  });
  const handleInnerLayout = React.useCallback(
    (e: { nativeEvent: { layout: { width: number } } }) =>
      setScrollViewWidth(e.nativeEvent.layout.width),
    [],
  );
  const handleSurfaceLayout = React.useCallback(
    (event: { nativeEvent: { layout: { width: number } } }) =>
      setSurfaceWidth(event.nativeEvent.layout.width),
    [],
  );
  const reviewViewport = React.useMemo(
    () => ({
      width: surfaceWidth || scrollViewWidth,
      gutterWidth: reviewGutterWidth,
      pinToViewport: !resolvedWrap,
      wrap: resolvedWrap,
      onGutterWidthChange: setReviewGutterWidth,
    }),
    [resolvedWrap, reviewGutterWidth, scrollViewWidth, surfaceWidth],
  );

  const outerScrollStyle = React.useMemo(
    () => [
      styles.verticalScroll,
      maxHeight !== undefined && inlineUnistylesStyle({ maxHeight }),
      fillAvailableHeight && styles.fillHeight,
    ],
    [maxHeight, fillAvailableHeight],
  );
  const verticalWrapperStyle = React.useMemo(
    () => (fillAvailableHeight ? styles.fillHeight : undefined),
    [fillAvailableHeight],
  );
  const linesContainerStyle = React.useMemo(
    () => [
      styles.linesContainer,
      resolvedWrap && styles.linesContainerWrap,
      !resolvedWrap && scrollViewWidth > 0 && inlineUnistylesStyle({ minWidth: scrollViewWidth }),
    ],
    [resolvedWrap, scrollViewWidth],
  );
  const keyedDiffLines = React.useMemo(() => {
    const hunks = diffPresentation.document.hunks;
    if (!hunks || hunks.length === 0) {
      return diffLines.map((line, index) => ({
        key: `${index}-${line.type}-${line.content}`,
        line,
      }));
    }
    const displayLines: DiffLine[] = [];
    for (const hunk of hunks) {
      displayLines.push({ type: "header", content: hunk.header });
      for (const documentLine of hunk.lines) {
        if (documentLine.line.type !== "header") displayLines.push(documentLine.line);
      }
    }
    return displayLines.map((line, index) => ({
      key: `${index}-${line.type}-${line.content}`,
      line,
    }));
  }, [diffLines, diffPresentation.document.hunks]);
  const webVerticalContentStyle = React.useMemo(
    () => [styles.verticalContent, fillAvailableHeight && styles.fillHeight],
    [fillAvailableHeight],
  );

  if (!diffPresentation.document.lines.length) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>{resolvedEmptyLabel}</Text>
      </View>
    );
  }

  const lines = (
    <View style={linesContainerStyle} dataSet={CODE_SURFACE_DATASET}>
      {keyedDiffLines.map(({ key, line }) => (
        <DiffLineRow key={key} line={line} wrap={resolvedWrap} />
      ))}
    </View>
  );

  // With wrap on, the horizontal scroller is skipped and long lines soft-wrap
  // inside the vertical scroll instead.
  const renderScrollableContent = (content: React.ReactNode) => {
    const horizontalScroll = resolvedWrap ? (
      <View style={styles.horizontalContent}>{content}</View>
    ) : (
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={!showDesktopWebScrollbar}
        contentContainerStyle={styles.horizontalContent}
        onLayout={handleInnerLayout}
      >
        {content}
      </ScrollView>
    );

    return (
      <View style={verticalWrapperStyle}>
        <ScrollView
          ref={verticalScrollRef}
          style={outerScrollStyle}
          contentContainerStyle={webVerticalContentStyle}
          nestedScrollEnabled
          onLayout={verticalScrollbar.onLayout}
          onScroll={verticalScrollbar.onScroll}
          onContentSizeChange={verticalScrollbar.onContentSizeChange}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={!showDesktopWebScrollbar}
        >
          {horizontalScroll}
        </ScrollView>
        {verticalScrollbar.overlay}
      </View>
    );
  };
  const renderContent = (content: React.ReactNode) => {
    if (!embedded) {
      return renderScrollableContent(content);
    }
    // The outer article owns vertical scrolling. Long unwrapped lines still
    // retain a local horizontal rail, which is the only axis this segment owns.
    return resolvedWrap ? (
      <View style={styles.horizontalContent}>{content}</View>
    ) : (
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={!showDesktopWebScrollbar}
        contentContainerStyle={styles.horizontalContent}
        onLayout={handleInnerLayout}
      >
        {content}
      </ScrollView>
    );
  };
  const lineContent = renderContent(lines);
  const structuralContent = renderContent(
    <View style={linesContainerStyle} dataSet={CODE_SURFACE_DATASET}>
      <StructuralDiff document={diffPresentation.document} layout={resolvedLayout} />
    </View>,
  );
  const diffSurface = (
    <View
      style={[
        styles.diffSurface,
        frame === "top" && styles.diffSurfaceTopOnly,
        frame === "bottom" && styles.diffSurfaceBottomOnly,
        frame === "none" && styles.diffSurfaceFrameless,
      ]}
      onLayout={handleSurfaceLayout}
    >
      {diffPresentation.effectivePresentation === "structural" ? structuralContent : lineContent}
    </View>
  );

  return (
    <DiffReviewActionsContext.Provider value={reviewActions}>
      <DiffReviewViewportContext.Provider value={reviewViewport}>
        <DiffLineNumberWidthContext.Provider value={lineNumberCellWidth}>
          <DiffCodeTypographyContext.Provider value={codeTypography}>
            <DiffCodeLineHeightContext.Provider value={codeLineHeight}>
              <DiffSyntaxTokensContext.Provider value={syntaxTokens}>
                <View style={fillAvailableHeight ? styles.fillHeight : undefined}>
                  {diffSurface}
                </View>
              </DiffSyntaxTokensContext.Provider>
            </DiffCodeLineHeightContext.Provider>
          </DiffCodeTypographyContext.Provider>
        </DiffLineNumberWidthContext.Provider>
      </DiffReviewViewportContext.Provider>
    </DiffReviewActionsContext.Provider>
  );
}

const styles = StyleSheet.create((theme) => {
  return {
    verticalScroll: {},
    fillHeight: {
      flex: 1,
      minHeight: 0,
    },
    verticalContent: {
      flexGrow: 1,
    },
    horizontalContent: {
      flexDirection: "column" as const,
    },
    linesContainer: {
      alignSelf: "flex-start",
    },
    linesContainerWrap: {
      alignSelf: "stretch",
    },
    emptyState: {
      padding: theme.spacing[4],
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    emptyText: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
    },
    diffSurface: {
      borderTopColor: theme.colors.border,
      borderTopWidth: theme.borderWidth[1],
      borderBottomColor: theme.colors.border,
      borderBottomWidth: theme.borderWidth[1],
      backgroundColor: theme.colors.surface1,
    },
    diffSurfaceTopOnly: {
      borderBottomWidth: 0,
    },
    diffSurfaceBottomOnly: {
      borderTopWidth: 0,
    },
    diffSurfaceFrameless: {
      borderTopWidth: 0,
      borderBottomWidth: 0,
    },
  };
});
