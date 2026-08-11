import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FileReadResult } from "@otto-code/client/internal/daemon-client";
import {
  ScrollView as RNScrollView,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { MarkdownTaskToggle } from "@/components/markdown/task-context";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useSessionStore, type ExplorerFile } from "@/stores/session-store";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { highlightCode, type HighlightToken } from "@otto-code/highlight";
import { syntaxTokenStyleFor } from "@/styles/syntax-token-styles";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { lineNumberGutterWidth } from "@/components/code-insets";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { exceedsHighlightBudget, renderedDocumentKind } from "@/components/file-pane-render-mode";
import { LargeFileNotice } from "@/components/large-file-notice";
import { toRenderedDocument } from "@/components/markdown/rendered-document";
import type { WorkspaceImageSource } from "@/components/markdown/image-context";
import { createWorkspaceImageBase } from "@/components/markdown/workspace-image-source";
import {
  findPreviewMatches,
  splitTokensForMatches,
  type MatchedTokenSegment,
  type PreviewFindQuery,
  type PreviewLineMatchRange,
} from "@/components/file-preview-find";
import { isNative, isWeb } from "@/constants/platform";
import { ImagePreview } from "@/components/image-preview";
import { readImageDimensions, type ImageDimensions } from "@/components/image-dimensions";
import type { AttachmentMetadata } from "@/attachments/types";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import { persistAttachmentFromBytes } from "@/attachments/service";
import { createPreviewAttachmentId, getFileNameFromPath } from "@/attachments/utils";
import { explorerFileFromReadResult } from "@/file-explorer/read-result";
import type { FileEol } from "@otto-code/protocol/messages";
import { formatFileSize } from "@/utils/format-file-size";
import { formatTimeAgo } from "@/utils/time";
import { resolveFilePreviewReadTarget } from "@/file-explorer/preview-target";
import type { WorkspaceFileLocation } from "@/workspace/file-open";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import {
  isFileQueryEnabled,
  resolveFilePreviewState,
  type FilePreviewState,
} from "@/components/file-pane-enabled";

interface CodeLineProps {
  tokens: HighlightToken[];
  lineNumber: number;
  gutterWidth: number;
  highlighted: boolean;
  /** Find hits on this line, if any; drives the search-match tinting. */
  matchRanges?: readonly PreviewLineMatchRange[];
}

/** What the preview learned about the file after reading it. */
export interface FilePreviewFileInfo {
  kind: "text" | "image" | "binary";
  /**
   * The preview renders this file through the markdown pipeline (`.md`,
   * `.markdown`, `.mmd`, `.mermaid`) rather than as highlighted lines - so
   * there is no line mapping for find-in-file to highlight.
   */
  isRenderedDocument: boolean;
  /** Bytes on disk; feeds the status bar in preview-only mode. */
  size: number;
  /** Null when the read path didn't report line endings (binary transfer). */
  eol: FileEol | null;
  /**
   * Natural pixel size, for images whose container we could parse. Null for
   * every other kind, and for an image format we have no header reader for -
   * in which case the viewer keeps working, minus the zoom controls.
   */
  imageDimensions: ImageDimensions | null;
}

/**
 * The status-bar-relevant facts about a previewed file, as plain primitives.
 * Separate from `FilePreview` so its null-handling doesn't spend that
 * component's cyclomatic-complexity budget.
 */
function readPreviewFileFacts(file: ExplorerFile | null | undefined): {
  kind: FilePreviewFileInfo["kind"] | null;
  size: number;
  eol: FileEol | null;
} {
  return {
    kind: file?.kind ?? null,
    size: file?.size ?? 0,
    eol: file?.eol ?? null,
  };
}

/**
 * Push what the read learned back up to the file tab, which uses it to gate the
 * editor modes and to fill the status bar.
 *
 * A hook rather than an inline effect so `FilePreview` keeps its
 * cyclomatic-complexity budget for the query itself. Every dependency is a
 * primitive - including the two halves of the dimensions - because a refetch
 * hands back equal-but-new objects, and depending on those would re-report on
 * every poll.
 */
function useReportedFileInfo({
  file,
  imageDimensions,
  path,
  onFileInfo,
}: {
  file: ExplorerFile | null;
  imageDimensions: ImageDimensions | null;
  path: string;
  onFileInfo?: (info: FilePreviewFileInfo | null) => void;
}): void {
  const { kind, size, eol } = readPreviewFileFacts(file);
  const width = imageDimensions?.width ?? null;
  const height = imageDimensions?.height ?? null;
  const onFileInfoRef = useRef(onFileInfo);
  onFileInfoRef.current = onFileInfo;
  useEffect(() => {
    if (!kind) {
      onFileInfoRef.current?.(null);
      return;
    }
    onFileInfoRef.current?.({
      kind,
      isRenderedDocument: kind === "text" && renderedDocumentKind(path) !== null,
      size,
      eol,
      imageDimensions: width !== null && height !== null ? { width, height } : null,
    });
  }, [eol, height, kind, path, size, width]);
}

/** Scroll-viewport snapshot the split view uses for proportional sync. */
export interface PreviewScrollMetrics {
  scrollTop: number;
  contentHeight: number;
  clientHeight: number;
}

/** A press landed in the preview content (split-view click alignment). */
export interface PreviewPointerDown {
  /** Y within the scrolled content, px. */
  contentY: number;
  /** Y within the visible viewport, px. */
  viewportOffsetY: number;
  contentHeight: number;
}

/** Imperative scroll surface the split view drives; never echoes sync events. */
export interface FilePreviewSyncHandle {
  getMetrics(): PreviewScrollMetrics;
  /** Scroll so `fraction` (0..1) of the scrollable range is above the viewport. */
  scrollToFraction(fraction: number): void;
  /** Scroll so content Y `contentY` sits `viewportOffsetY` px below the viewport top. */
  scrollToContentY(contentY: number, viewportOffsetY: number): void;
  /**
   * Scroll a 1-based line just below the top of the viewport - the preview's
   * answer to the editor's `goToLine`, so the outline can drive both views.
   * Exact over the code view, whose lines are a fixed height. Rendered markdown
   * has no line→pixel mapping, so it lands proportionally: the same
   * approximation the split view already scrolls by.
   */
  scrollToLine(line: number): void;
}

interface FilePreviewBodyProps {
  preview: ExplorerFile | null;
  state: FilePreviewState;
  showWebScrollbar: boolean;
  isMobile: boolean;
  location: WorkspaceFileLocation;
  imagePreviewUri: string | null;
  svgXml: string | null;
  imageDimensions: ImageDimensions | null;
  /** Where a rendered document's own relative image srcs resolve; null outside a workspace. */
  workspaceImages: WorkspaceImageSource | null;
  /**
   * Soft-wrap long code lines instead of scrolling sideways - the same
   * preference the editor toolbar toggles, so the two views agree. Compact
   * always wraps: there is no room to scroll sideways on a phone.
   */
  wrapLines?: boolean;
  /** Live buffer contents to render instead of the disk read (split view). */
  contentOverride?: string | null;
  /** Active find-in-preview query; null when the find strip is closed/empty. */
  findQuery?: PreviewFindQuery | null;
  /** Which match (0-based) is active, for the stronger highlight + scroll. */
  activeMatchIndex?: number;
  /** Reports the total match count back to the find strip on every change. */
  onFindMatchCount?: (count: number) => void;
  syncRef?: React.Ref<FilePreviewSyncHandle>;
  onScrolledSync?: (metrics: PreviewScrollMetrics) => void;
  onPointerDownSync?: (pointer: PreviewPointerDown) => void;
  /** Ticking a rendered task list; `line` is already a line of the file. */
  onToggleTask?: MarkdownTaskToggle | null;
}

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface FileLineSelection {
  lineStart: number;
  lineEnd: number;
}

async function createFilePanePreview(file: FileReadResult | null): Promise<{
  file: ExplorerFile | null;
  imageAttachment: AttachmentMetadata | null;
  svgXml: string | null;
  imageDimensions: ImageDimensions | null;
}> {
  if (!file) {
    return { file: null, imageAttachment: null, svgXml: null, imageDimensions: null };
  }

  const explorerFile = explorerFileFromReadResult(file);
  if (file.kind !== "image") {
    return { file: explorerFile, imageAttachment: null, svgXml: null, imageDimensions: null };
  }

  // Parsed from the bytes we already hold rather than measured after paint:
  // fit-to-pane, the zoom percentage and the status-bar readout all need the
  // natural size on the first frame, and there is no synchronous cross-platform
  // way to ask the image itself.
  const imageDimensions = readImageDimensions(file.bytes, file.mime);

  // Native Image can't decode SVG; render the raw XML via react-native-svg
  // instead of persisting an attachment it could never display.
  if (isNative && file.mime === "image/svg+xml") {
    return {
      file: explorerFile,
      imageAttachment: null,
      svgXml: new TextDecoder().decode(file.bytes),
      imageDimensions,
    };
  }

  const imageAttachment = await persistAttachmentFromBytes({
    id: createPreviewAttachmentId({
      mimeType: file.mime,
      path: file.path,
      size: file.size,
      modifiedAt: file.modifiedAt,
      contentLength: file.bytes.byteLength,
    }),
    bytes: file.bytes,
    mimeType: file.mime,
    fileName: getFileNameFromPath(file.path),
  });

  return {
    file: explorerFile,
    imageAttachment,
    svgXml: null,
    imageDimensions,
  };
}

function clampLineSelection(input: {
  lineStart?: number;
  lineEnd?: number;
  lineCount: number;
}): FileLineSelection | null {
  if (!input.lineStart || input.lineStart <= 0 || input.lineCount <= 0) {
    return null;
  }
  const lineStart = Math.min(Math.floor(input.lineStart), input.lineCount);
  const rawLineEnd =
    input.lineEnd && input.lineEnd >= input.lineStart ? input.lineEnd : input.lineStart;
  const lineEnd = Math.min(Math.floor(rawLineEnd), input.lineCount);
  return { lineStart, lineEnd: Math.max(lineStart, lineEnd) };
}

const CodeLine = React.memo(function CodeLine({
  tokens,
  lineNumber,
  gutterWidth,
  highlighted,
  matchRanges,
}: CodeLineProps) {
  const gutterStyle = useMemo(
    () => [codeLineStyles.gutter, inlineUnistylesStyle({ width: gutterWidth })],
    [gutterWidth],
  );
  const lineStyle = useMemo(
    () => [codeLineStyles.line, highlighted && codeLineStyles.highlightedLine],
    [highlighted],
  );
  // With find hits on the line, re-cut the tokens so each match becomes its own
  // (still syntax-styled) segment carrying the highlight; otherwise the plain
  // token stream renders as before.
  const keyedSegments = useMemo(() => {
    if (!matchRanges || matchRanges.length === 0) {
      return null;
    }
    return splitTokensForMatches(tokens, matchRanges).map((segment, index) => ({
      key: `${index}-${segment.text}`,
      segment,
    }));
  }, [tokens, matchRanges]);
  const keyedTokens = useMemo(
    () => tokens.map((token, index) => ({ key: `${index}-${token.text}`, token })),
    [tokens],
  );
  return (
    <View style={lineStyle}>
      <View style={gutterStyle}>
        <Text numberOfLines={1} style={codeLineStyles.gutterText}>
          {String(lineNumber)}
        </Text>
      </View>
      <Text selectable style={codeLineStyles.lineText}>
        {keyedSegments
          ? keyedSegments.map(({ key, segment }) => <CodeLineSegment key={key} segment={segment} />)
          : keyedTokens.map(({ key, token }) => <CodeLineToken key={key} token={token} />)}
      </Text>
    </View>
  );
});

interface CodeLineTokenProps {
  token: HighlightToken;
}

function CodeLineToken({ token }: CodeLineTokenProps) {
  return <Text style={syntaxTokenStyleFor(token.style)}>{token.text}</Text>;
}

function CodeLineSegment({ segment }: { segment: MatchedTokenSegment }) {
  const style = useMemo(() => {
    const base = syntaxTokenStyleFor(segment.style);
    if (segment.highlight === "active") {
      return [base, codeLineStyles.findMatchActive];
    }
    if (segment.highlight === "match") {
      return [base, codeLineStyles.findMatch];
    }
    return base;
  }, [segment.highlight, segment.style]);
  return <Text style={style}>{segment.text}</Text>;
}

const codeLineStyles = StyleSheet.create((theme) => ({
  line: {
    flexDirection: "row",
  },
  highlightedLine: {
    backgroundColor: theme.colors.accentBorder,
  },
  findMatch: {
    backgroundColor: theme.colors.terminal.selectionBackground,
  },
  findMatchActive: {
    backgroundColor: theme.colors.borderAccent,
  },
  gutter: {
    alignItems: "flex-end",
    paddingRight: theme.spacing[3],
    flexShrink: 0,
  },
  gutterText: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    lineHeight: theme.fontSize.code * 1.45,
    opacity: 0.4,
    userSelect: "none",
  },
  lineText: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    lineHeight: theme.fontSize.code * 1.45,
    flex: 1,
  },
}));

/**
 * Find-in-preview: scan the file for the query, report the count, keep the
 * active match in view, and hand back the per-line ranges the code lines tint.
 * Lives as a hook so its several effects don't spend FilePreviewBody's
 * cyclomatic-complexity budget. `enabled` is false for the markdown and
 * image/binary views, which have no line-mapped text to highlight.
 */
function usePreviewFindHighlights({
  enabled,
  content,
  findQuery,
  activeMatchIndex,
  onFindMatchCount,
  scrollRef,
  metricsRef,
  lineHeight,
}: {
  enabled: boolean;
  content: string;
  findQuery: PreviewFindQuery | null;
  activeMatchIndex: number;
  onFindMatchCount?: (count: number) => void;
  scrollRef: React.RefObject<RNScrollView | null>;
  metricsRef: React.RefObject<PreviewScrollMetrics>;
  lineHeight: number;
}): Map<number, PreviewLineMatchRange[]> {
  const findMatches = useMemo(() => {
    if (!enabled || !findQuery) {
      return [];
    }
    return findPreviewMatches(content, findQuery);
  }, [enabled, findQuery, content]);

  const onFindMatchCountRef = useRef(onFindMatchCount);
  onFindMatchCountRef.current = onFindMatchCount;
  useEffect(() => {
    onFindMatchCountRef.current?.(findMatches.length);
  }, [findMatches]);

  // The active match's line carries the stronger highlight; every other hit
  // (on this line or another) gets the base match tint.
  const matchRangesByLine = useMemo(() => {
    const byLine = new Map<number, PreviewLineMatchRange[]>();
    findMatches.forEach((match, index) => {
      const ranges = byLine.get(match.line) ?? [];
      ranges.push({ start: match.start, end: match.end, active: index === activeMatchIndex });
      byLine.set(match.line, ranges);
    });
    return byLine;
  }, [findMatches, activeMatchIndex]);

  // Keep the active match in view: land it a third of the way down so there is
  // context above it, clamped at the document start.
  const activeMatchLine =
    findMatches.length > 0 ? (findMatches[activeMatchIndex]?.line ?? null) : null;
  useEffect(() => {
    if (activeMatchLine === null) {
      return;
    }
    const timeout = setTimeout(() => {
      const targetTop = (activeMatchLine - 1) * lineHeight;
      const viewportLead = Math.min(metricsRef.current.clientHeight / 3, targetTop);
      scrollRef.current?.scrollTo({ y: Math.max(0, targetTop - viewportLead), animated: false });
    }, 0);
    return () => clearTimeout(timeout);
  }, [activeMatchLine, lineHeight, metricsRef, scrollRef]);

  return matchRangesByLine;
}

function FilePreviewBody({
  preview,
  state,
  showWebScrollbar,
  isMobile,
  location,
  imagePreviewUri,
  svgXml,
  imageDimensions,
  workspaceImages,
  wrapLines = false,
  contentOverride,
  findQuery,
  activeMatchIndex = 0,
  onFindMatchCount,
  syncRef,
  onScrolledSync,
  onPointerDownSync,
  onToggleTask = null,
}: FilePreviewBodyProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const filePath = location.path;
  // Which files render through the markdown pipeline instead of as highlighted
  // source. A deep link to a line always wins - you asked for that line.
  const documentKind = useMemo(
    () => (preview?.kind === "text" && !location.lineStart ? renderedDocumentKind(filePath) : null),
    [filePath, location.lineStart, preview?.kind],
  );
  const effectiveContent = useMemo(() => {
    if (preview?.kind !== "text") {
      return "";
    }
    return contentOverride ?? preview.content ?? "";
  }, [contentOverride, preview]);

  // Hoisted out of the render branch below so the memo and the callback that
  // depends on it are hooks, not work redone on every keystroke of a live
  // split-view draft.
  const renderedDocument = useMemo(
    () => (documentKind ? toRenderedDocument(documentKind, effectiveContent) : null),
    [documentKind, effectiveContent],
  );

  /**
   * The renderer counts lines of the rendered body; the caller writes to the
   * file. `bodyLineOffset` is null for the kinds whose body is a translation
   * rather than a slice of the source, and a null handler is what keeps their
   * checkboxes read-only instead of wrong.
   */
  const bodyLineOffset = renderedDocument?.bodyLineOffset ?? null;
  const handleToggleTask = useMemo<MarkdownTaskToggle | null>(() => {
    if (!onToggleTask || bodyLineOffset === null) {
      return null;
    }
    return ({ line, checked }) => onToggleTask({ line: line + bodyLineOffset, checked });
  }, [bodyLineOffset, onToggleTask]);

  const previewScrollRef = useRef<RNScrollView>(null);
  const scrollbar = useWebScrollViewScrollbar(previewScrollRef, {
    enabled: showWebScrollbar,
  });
  const horizontalScrollRef = useRef<RNScrollView>(null);
  const horizontalScrollbar = useWebScrollViewScrollbar(horizontalScrollRef, {
    enabled: showWebScrollbar,
    axis: "horizontal",
  });

  // Split-view sync plumbing: track the viewport imperatively (re-rendering
  // per scroll frame would be wasteful) and swallow the echo of our own
  // programmatic scrolls so the two panes cannot ping-pong.
  const syncMetricsRef = useRef<PreviewScrollMetrics>({
    scrollTop: 0,
    contentHeight: 0,
    clientHeight: 0,
  });
  const suppressNextScrollSyncRef = useRef(false);
  const onScrolledSyncRef = useRef(onScrolledSync);
  onScrolledSyncRef.current = onScrolledSync;
  const onPointerDownSyncRef = useRef(onPointerDownSync);
  onPointerDownSyncRef.current = onPointerDownSync;

  const handleSyncScroll = useCallback((event: { nativeEvent: NativeScrollEvent }) => {
    const metrics = syncMetricsRef.current;
    metrics.scrollTop = event.nativeEvent.contentOffset.y;
    metrics.contentHeight = event.nativeEvent.contentSize.height;
    metrics.clientHeight = event.nativeEvent.layoutMeasurement.height;
    if (suppressNextScrollSyncRef.current) {
      suppressNextScrollSyncRef.current = false;
      return;
    }
    onScrolledSyncRef.current?.({ ...metrics });
  }, []);

  const handleSyncLayout = useCallback((event: LayoutChangeEvent) => {
    syncMetricsRef.current.clientHeight = event.nativeEvent.layout.height;
  }, []);

  const handleSyncContentSize = useCallback((_width: number, height: number) => {
    syncMetricsRef.current.contentHeight = height;
  }, []);

  // Merged scrollbar + sync handlers so the JSX passes stable references.
  const {
    onLayout: scrollbarOnLayout,
    onScroll: scrollbarOnScroll,
    onContentSizeChange: scrollbarOnContentSizeChange,
  } = scrollbar;
  const handleVerticalLayout = useCallback(
    (event: LayoutChangeEvent) => {
      scrollbarOnLayout(event);
      handleSyncLayout(event);
    },
    [handleSyncLayout, scrollbarOnLayout],
  );
  const handleVerticalScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollbarOnScroll(event);
      handleSyncScroll(event);
    },
    [handleSyncScroll, scrollbarOnScroll],
  );
  const handleVerticalContentSizeChange = useCallback(
    (width: number, height: number) => {
      scrollbarOnContentSizeChange(width, height);
      handleSyncContentSize(width, height);
    },
    [handleSyncContentSize, scrollbarOnContentSizeChange],
  );

  const scrollToSyncTop = useCallback((top: number) => {
    const metrics = syncMetricsRef.current;
    const max = Math.max(0, metrics.contentHeight - metrics.clientHeight);
    const clamped = Math.max(0, Math.min(top, max));
    if (Math.abs(clamped - metrics.scrollTop) < 0.5) {
      return;
    }
    suppressNextScrollSyncRef.current = true;
    metrics.scrollTop = clamped;
    previewScrollRef.current?.scrollTo({ y: clamped, animated: false });
  }, []);

  // Click alignment is web-only: it needs the content's bounding rect to turn
  // a pointer position into a content Y.
  const syncContentRef = useRef<View>(null);
  const handleSyncPointerDown = useCallback((event: { nativeEvent: { clientY?: number } }) => {
    if (!isWeb || !onPointerDownSyncRef.current) {
      return;
    }
    const node = syncContentRef.current as unknown as HTMLElement | null;
    const clientY = event.nativeEvent.clientY;
    if (!node || typeof clientY !== "number" || typeof node.getBoundingClientRect !== "function") {
      return;
    }
    const contentY = clientY - node.getBoundingClientRect().top;
    const metrics = syncMetricsRef.current;
    onPointerDownSyncRef.current({
      contentY,
      viewportOffsetY: contentY - metrics.scrollTop,
      contentHeight: metrics.contentHeight,
    });
  }, []);

  const highlightTooLarge = useMemo(
    () => preview?.kind === "text" && !documentKind && exceedsHighlightBudget(effectiveContent),
    [documentKind, preview, effectiveContent],
  );

  const highlightedLines = useMemo(() => {
    if (!preview || preview.kind !== "text" || documentKind || highlightTooLarge) {
      return null;
    }

    return highlightCode(effectiveContent, filePath);
  }, [documentKind, highlightTooLarge, preview, effectiveContent, filePath]);

  const gutterWidth = useMemo(() => {
    if (!highlightedLines) return 0;
    return lineNumberGutterWidth(highlightedLines.length, theme.fontSize.code);
  }, [highlightedLines, theme.fontSize.code]);
  const lineHeight = theme.fontSize.code * 1.45;
  const lineSelection = useMemo(() => {
    if (!highlightedLines) {
      return null;
    }
    return clampLineSelection({
      lineStart: location.lineStart,
      lineEnd: location.lineEnd,
      lineCount: highlightedLines.length,
    });
  }, [highlightedLines, location.lineEnd, location.lineStart]);

  // Declared here, below the layout facts it reads: `scrollToLine` needs the
  // code view's line height to be exact, and the split-view methods have no
  // reason to be measured any earlier.
  useImperativeHandle(
    syncRef,
    () => ({
      getMetrics: () => ({ ...syncMetricsRef.current }),
      scrollToFraction: (fraction: number) => {
        const metrics = syncMetricsRef.current;
        const max = Math.max(0, metrics.contentHeight - metrics.clientHeight);
        scrollToSyncTop(Math.max(0, Math.min(fraction, 1)) * max);
      },
      scrollToContentY: (contentY: number, viewportOffsetY: number) => {
        scrollToSyncTop(contentY - viewportOffsetY);
      },
      scrollToLine: (line: number) => {
        const target = Math.max(1, line);
        if (highlightedLines) {
          scrollToSyncTop((target - 1) * lineHeight);
          return;
        }
        // Rendered markdown: prose has no line height, so place the line
        // proportionally through the rendered document - close enough to land
        // on the heading the outline named.
        const lineCount = effectiveContent ? effectiveContent.split("\n").length : 0;
        if (lineCount <= 0) {
          return;
        }
        const metrics = syncMetricsRef.current;
        scrollToSyncTop((Math.min(target, lineCount) - 1) * (metrics.contentHeight / lineCount));
      },
    }),
    [effectiveContent, highlightedLines, lineHeight, scrollToSyncTop],
  );

  const matchRangesByLine = usePreviewFindHighlights({
    enabled: Boolean(highlightedLines),
    content: effectiveContent,
    findQuery: findQuery ?? null,
    activeMatchIndex,
    onFindMatchCount,
    scrollRef: previewScrollRef,
    metricsRef: syncMetricsRef,
    lineHeight,
  });

  useEffect(() => {
    if (!lineSelection) {
      return;
    }
    const timeout = setTimeout(() => {
      previewScrollRef.current?.scrollTo({
        y: Math.max(0, (lineSelection.lineStart - 1) * lineHeight),
        animated: false,
      });
    }, 0);
    return () => clearTimeout(timeout);
  }, [lineHeight, lineSelection]);

  if (state === "loading") {
    return (
      <View style={styles.centerState}>
        <LoadingSpinner size="small" />
        <Text style={styles.loadingText}>{t("panels.file.loading")}</Text>
      </View>
    );
  }

  if (state === "unavailable" || !preview) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.emptyText}>{t("panels.file.noPreview")}</Text>
      </View>
    );
  }

  if (preview.kind === "text") {
    if (renderedDocument) {
      const { frontmatter, body, enableHtmlish } = renderedDocument;
      return (
        <View style={styles.previewScrollContainer}>
          <RNScrollView
            ref={previewScrollRef}
            style={styles.previewContent}
            contentContainerStyle={styles.previewMarkdownScrollContent}
            onLayout={handleVerticalLayout}
            onScroll={handleVerticalScroll}
            onContentSizeChange={handleVerticalContentSizeChange}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={!showWebScrollbar}
          >
            <View ref={syncContentRef} onPointerDown={handleSyncPointerDown}>
              {frontmatter ? (
                <View style={styles.frontmatterBlock} testID="file-pane-frontmatter">
                  <Text selectable style={styles.frontmatterText}>
                    {frontmatter}
                  </Text>
                </View>
              ) : null}
              {/* A repo document must not be able to reach the network just by being previewed -
                  but it may show its own images, read back through the daemon. */}
              <MarkdownRenderer
                text={body}
                remoteImages="altText"
                enableHtmlish={enableHtmlish}
                workspaceImages={workspaceImages}
                onToggleTask={handleToggleTask}
              />
            </View>
          </RNScrollView>
          {scrollbar.overlay}
        </View>
      );
    }

    const lines = highlightedLines ?? [[{ text: effectiveContent, style: null }]];
    const keyedLines = lines.map((tokens, index) => ({
      key: `line-${index}`,
      tokens,
      lineNumber: index + 1,
    }));
    const codeLines = (
      <View
        ref={syncContentRef}
        onPointerDown={handleSyncPointerDown}
        dataSet={CODE_SURFACE_DATASET}
      >
        {keyedLines.map(({ key, tokens, lineNumber }) => (
          <CodeLine
            key={key}
            tokens={tokens}
            lineNumber={lineNumber}
            gutterWidth={gutterWidth}
            highlighted={
              Boolean(lineSelection) &&
              lineNumber >= (lineSelection?.lineStart ?? 0) &&
              lineNumber <= (lineSelection?.lineEnd ?? 0)
            }
            matchRanges={matchRangesByLine.get(lineNumber)}
          />
        ))}
      </View>
    );

    return (
      <View style={styles.previewScrollContainer}>
        <LargeFileNotice visible={highlightTooLarge} />
        <RNScrollView
          ref={previewScrollRef}
          style={styles.previewContent}
          onLayout={handleVerticalLayout}
          onScroll={handleVerticalScroll}
          onContentSizeChange={handleVerticalContentSizeChange}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={!showWebScrollbar}
        >
          {/* Wrapping is the absence of the horizontal scroller: the line text
              already wraps when nothing lets it grow sideways. */}
          {isMobile || wrapLines ? (
            <View style={styles.previewCodeScrollContent}>{codeLines}</View>
          ) : (
            <RNScrollView
              ref={horizontalScrollRef}
              horizontal
              nestedScrollEnabled
              onLayout={horizontalScrollbar.onLayout}
              onScroll={horizontalScrollbar.onScroll}
              onContentSizeChange={horizontalScrollbar.onContentSizeChange}
              scrollEventThrottle={16}
              showsHorizontalScrollIndicator={!showWebScrollbar}
              contentContainerStyle={styles.previewCodeScrollContent}
            >
              {codeLines}
            </RNScrollView>
          )}
        </RNScrollView>
        {scrollbar.overlay}
        {horizontalScrollbar.overlay}
      </View>
    );
  }

  if (preview.kind === "image") {
    // The bytes are already in hand by the time `preview` exists; this waits on
    // the attachment write that turns them into a URL the platform can load.
    if (!svgXml && !imagePreviewUri) {
      return (
        <View style={styles.centerState}>
          <LoadingSpinner size="small" />
          <Text style={styles.loadingText}>{t("panels.file.loading")}</Text>
        </View>
      );
    }

    return (
      <ImagePreview
        uri={imagePreviewUri}
        svgXml={svgXml}
        dimensions={imageDimensions}
        byteSize={preview.size}
        sourceKey={filePath}
        showWebScrollbar={showWebScrollbar}
      />
    );
  }

  return <BinaryPreview file={preview} />;
}

/**
 * The end of the line for a file nothing can render: a plain statement plus the
 * facts a file manager would show. It stays a statement rather than becoming a
 * hex dump on purpose - a hex view of an arbitrary binary answers a question
 * almost nobody opening a file tab is asking, and the honest read here is
 * "there is nothing to see", said clearly.
 */
function BinaryPreview({ file }: { file: ExplorerFile }) {
  const { t } = useTranslation();
  const extension = useMemo(() => {
    // `getFileNameFromPath` returns null for a path that is empty or all
    // separators - a shape the explorer should never hand us, but the facts row
    // simply omits the extension rather than asserting it away.
    const name = getFileNameFromPath(file.path);
    if (!name) {
      return null;
    }
    // A leading dot is the whole name (`.env`), not an extension.
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot) : null;
  }, [file.path]);
  const modified = useMemo(() => {
    const date = new Date(file.modifiedAt);
    return Number.isNaN(date.getTime()) ? null : formatTimeAgo(date);
  }, [file.modifiedAt]);

  const facts = [
    t("panels.file.binaryPreviewKind"),
    formatFileSize({ size: file.size }),
    extension,
  ].filter(Boolean);

  return (
    <View style={styles.centerState}>
      <Text style={styles.emptyText}>{t("panels.file.binaryPreviewUnavailable")}</Text>
      <Text style={styles.binaryMetaText}>{t("panels.file.binaryPreviewHint")}</Text>
      <Text style={styles.binaryMetaText}>{facts.join(" · ")}</Text>
      {modified ? (
        <Text style={styles.binaryMetaText}>
          {t("panels.file.binaryPreviewModified", { when: modified })}
        </Text>
      ) : null}
    </View>
  );
}

export interface FilePreviewProps {
  serverId: string;
  workspaceRoot: string;
  location: WorkspaceFileLocation;
  /** Soft-wrap long code lines instead of scrolling sideways. */
  wrapLines?: boolean;
  /** Live buffer contents to render instead of the disk read (split view). */
  contentOverride?: string | null;
  /** Reports what kind of file the read produced (gates the editor modes). */
  onFileInfo?: (info: FilePreviewFileInfo | null) => void;
  /** Active find-in-preview query; null when the find strip is closed/empty. */
  findQuery?: PreviewFindQuery | null;
  /** Which match (0-based) is active, for the stronger highlight + scroll. */
  activeMatchIndex?: number;
  /** Reports the total match count back to the find strip on every change. */
  onFindMatchCount?: (count: number) => void;
  syncRef?: React.Ref<FilePreviewSyncHandle>;
  onScrolledSync?: (metrics: PreviewScrollMetrics) => void;
  onPointerDownSync?: (pointer: PreviewPointerDown) => void;
  /**
   * Makes rendered task lists tickable, with `line` already translated into a
   * line of the file rather than of the rendered body. Unset leaves them as
   * read-only glyphs, which is right for any surface that does not own an
   * editable buffer for this file.
   */
  onToggleTask?: MarkdownTaskToggle | null;
}

export function FilePreview({
  serverId,
  workspaceRoot,
  location,
  wrapLines,
  contentOverride,
  onFileInfo,
  findQuery,
  activeMatchIndex,
  onFindMatchCount,
  syncRef,
  onScrolledSync,
  onPointerDownSync,
  onToggleTask = null,
}: FilePreviewProps) {
  const { t } = useTranslation();
  const isMobile = useIsCompactFormFactor();
  // Ungated on compact: the app's overlay bar is wanted on mobile web too,
  // where the platform otherwise draws its dated one. No-ops off web.
  const showWebScrollbar = isWeb;

  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const normalizedWorkspaceRoot = useMemo(() => workspaceRoot.trim(), [workspaceRoot]);
  const normalizedFilePath = useMemo(() => trimNonEmpty(location.path), [location.path]);
  const readTarget = useMemo(
    () =>
      normalizedFilePath
        ? resolveFilePreviewReadTarget({
            path: normalizedFilePath,
            workspaceRoot: normalizedWorkspaceRoot,
          })
        : null,
    [normalizedFilePath, normalizedWorkspaceRoot],
  );

  // Re-read the file when this pane becomes visible again (#445). `isActive`
  // covers tab switches, `isAppVisible` the whole-app background/foreground; the
  // gate itself lives in isFileQueryEnabled.
  const isActive = useRetainedPanelActive();
  const isAppVisible = useAppVisible();

  const hasReadTarget = Boolean(client && readTarget);
  const query = useQuery({
    queryKey: ["workspaceFile", serverId, readTarget?.cwd ?? null, readTarget?.path ?? null],
    enabled: isFileQueryEnabled({
      hasReadTarget,
      isTabActive: isActive,
      isAppVisible,
    }),
    queryFn: async () => {
      if (!client || !readTarget) {
        return {
          file: null as ExplorerFile | null,
          imageAttachment: null,
          svgXml: null,
          imageDimensions: null as ImageDimensions | null,
          error: t("workspace.terminal.hostDisconnected"),
        };
      }
      try {
        const file = await client.readFile(readTarget.cwd, readTarget.path);
        const preview = await createFilePanePreview(file);
        return {
          file: preview.file,
          imageAttachment: preview.imageAttachment,
          svgXml: preview.svgXml,
          imageDimensions: preview.imageDimensions,
          error: null,
        };
      } catch (error) {
        return {
          file: null,
          imageAttachment: null,
          svgXml: null,
          imageDimensions: null,
          error: error instanceof Error ? error.message : t("panels.file.failedToLoad"),
        };
      }
    },
    staleTime: 5_000,
    refetchOnMount: true,
  });
  const imagePreviewUri = useAttachmentPreviewUrl(query.data?.imageAttachment ?? null);

  // What a rendered document resolves `![](docs/x.png)` against. Reads go out with
  // the workspace root as their cwd, and only for paths contained under it - a
  // document outside the workspace gets no base at all, and keeps showing alt text.
  const workspaceImages = useMemo<WorkspaceImageSource | null>(() => {
    if (!client || !normalizedFilePath) {
      return null;
    }
    const base = createWorkspaceImageBase({
      serverId,
      workspaceRoot: normalizedWorkspaceRoot,
      documentPath: normalizedFilePath,
    });
    return base ? { base, reader: client } : null;
  }, [client, normalizedFilePath, normalizedWorkspaceRoot, serverId]);

  // The viewer is always clean, so it simply follows the disk: any watch
  // event re-reads the file. COMPAT(textEditor): old daemons ignore the
  // subscription; the viewer falls back to its tab-activation refetch.
  const refetchFile = query.refetch;
  useEffect(() => {
    if (!client || !readTarget) {
      return;
    }
    return client.watchFile(readTarget.cwd, readTarget.path, () => {
      void refetchFile();
    });
  }, [client, readTarget, refetchFile]);

  const imageDimensions = query.data?.imageDimensions ?? null;
  useReportedFileInfo({
    file: query.data?.file ?? null,
    imageDimensions,
    path: location.path,
    onFileInfo,
  });

  return (
    <View style={styles.container} testID="workspace-file-pane">
      {query.data?.error ? (
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{query.data.error}</Text>
        </View>
      ) : null}

      <FilePreviewBody
        preview={query.data?.file ?? null}
        state={resolveFilePreviewState({
          hasReadTarget,
          isPending: query.isPending,
          hasPreview: Boolean(query.data?.file),
        })}
        showWebScrollbar={showWebScrollbar}
        isMobile={isMobile}
        location={location}
        imagePreviewUri={imagePreviewUri}
        svgXml={query.data?.svgXml ?? null}
        imageDimensions={imageDimensions}
        workspaceImages={workspaceImages}
        wrapLines={wrapLines}
        contentOverride={contentOverride}
        findQuery={findQuery}
        activeMatchIndex={activeMatchIndex}
        onFindMatchCount={onFindMatchCount}
        syncRef={syncRef}
        onScrolledSync={onScrolledSync}
        onPointerDownSync={onPointerDownSync}
        onToggleTask={onToggleTask}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  return {
    container: {
      flex: 1,
      minHeight: 0,
      // Match the editable CodeMirror well so read-only source and rendered
      // file previews retain the same reading surface.
      backgroundColor: theme.colors.surfaceCode,
    },
    centerState: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: theme.spacing[4],
    },
    loadingText: {
      marginTop: theme.spacing[2],
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.sm,
    },
    errorText: {
      color: theme.colors.destructive,
      fontSize: theme.fontSize.sm,
      textAlign: "center",
    },
    emptyText: {
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.sm,
      textAlign: "center",
    },
    binaryMetaText: {
      marginTop: theme.spacing[2],
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.sm,
    },
    previewScrollContainer: {
      flex: 1,
      minHeight: 0,
    },
    previewContent: {
      flex: 1,
      minHeight: 0,
    },
    previewCodeScrollContent: {
      padding: theme.spacing[4],
    },
    previewMarkdownScrollContent: {
      padding: theme.spacing[4],
    },
    frontmatterBlock: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 8,
      backgroundColor: theme.colors.surface1,
      paddingHorizontal: theme.spacing[3],
      paddingVertical: theme.spacing[2],
      marginBottom: theme.spacing[3],
    },
    frontmatterText: {
      color: theme.colors.foregroundMuted,
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
      lineHeight: theme.fontSize.code * 1.45,
    },
  };
});
