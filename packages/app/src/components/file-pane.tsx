import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import type { FileReadResult } from "@otto-code/client/internal/daemon-client";
import {
  ActivityIndicator,
  Image as RNImage,
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
import { useIsCompactFormFactor } from "@/constants/layout";
import { useSessionStore, type ExplorerFile } from "@/stores/session-store";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { highlightCode, type HighlightToken } from "@otto-code/highlight";
import { syntaxTokenStyleFor } from "@/styles/syntax-token-styles";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { lineNumberGutterWidth } from "@/components/code-insets";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { isRenderedMarkdownFile } from "@/components/file-pane-render-mode";
import { splitMarkdownFrontmatter } from "@/components/markdown-frontmatter";
import { isNative, isWeb } from "@/constants/platform";
import { SvgXml } from "react-native-svg";
import type { AttachmentMetadata } from "@/attachments/types";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import { persistAttachmentFromBytes } from "@/attachments/service";
import { createPreviewAttachmentId, getFileNameFromPath } from "@/attachments/utils";
import { explorerFileFromReadResult } from "@/file-explorer/read-result";
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
}

/** What the preview learned about the file after reading it. */
export interface FilePreviewFileInfo {
  kind: "text" | "image" | "binary";
  isMarkdown: boolean;
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
}

interface FilePreviewBodyProps {
  preview: ExplorerFile | null;
  state: FilePreviewState;
  showDesktopWebScrollbar: boolean;
  isMobile: boolean;
  location: WorkspaceFileLocation;
  imagePreviewUri: string | null;
  svgXml: string | null;
  /** Live buffer contents to render instead of the disk read (split view). */
  contentOverride?: string | null;
  syncRef?: React.Ref<FilePreviewSyncHandle>;
  onScrolledSync?: (metrics: PreviewScrollMetrics) => void;
  onPointerDownSync?: (pointer: PreviewPointerDown) => void;
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

function formatFileSize({ size }: { size: number }): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function createFilePanePreview(file: FileReadResult | null): Promise<{
  file: ExplorerFile | null;
  imageAttachment: AttachmentMetadata | null;
  svgXml: string | null;
}> {
  if (!file) {
    return { file: null, imageAttachment: null, svgXml: null };
  }

  const explorerFile = explorerFileFromReadResult(file);
  if (file.kind !== "image") {
    return { file: explorerFile, imageAttachment: null, svgXml: null };
  }

  // Native Image can't decode SVG; render the raw XML via react-native-svg
  // instead of persisting an attachment it could never display.
  if (isNative && file.mime === "image/svg+xml") {
    return {
      file: explorerFile,
      imageAttachment: null,
      svgXml: new TextDecoder().decode(file.bytes),
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
}: CodeLineProps) {
  const gutterStyle = useMemo(
    () => [codeLineStyles.gutter, inlineUnistylesStyle({ width: gutterWidth })],
    [gutterWidth],
  );
  const lineStyle = useMemo(
    () => [codeLineStyles.line, highlighted && codeLineStyles.highlightedLine],
    [highlighted],
  );
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
        {keyedTokens.map(({ key, token }) => (
          <CodeLineToken key={key} token={token} />
        ))}
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

const codeLineStyles = StyleSheet.create((theme) => ({
  line: {
    flexDirection: "row",
  },
  highlightedLine: {
    backgroundColor: theme.colors.accentBorder,
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

function NativeSvgPreview({ xml, size }: { xml: string; size: number }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const handleError = useCallback(() => setFailed(true), []);
  if (failed) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.emptyText}>{t("panels.file.binaryPreviewUnavailable")}</Text>
        <Text style={styles.binaryMetaText}>{formatFileSize({ size })}</Text>
      </View>
    );
  }
  return (
    <View style={styles.previewSvg}>
      <SvgXml xml={xml} width="100%" height="100%" onError={handleError} />
    </View>
  );
}

function FilePreviewBody({
  preview,
  state,
  showDesktopWebScrollbar,
  isMobile,
  location,
  imagePreviewUri,
  svgXml,
  contentOverride,
  syncRef,
  onScrolledSync,
  onPointerDownSync,
}: FilePreviewBodyProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const filePath = location.path;
  const isMarkdownFile =
    preview?.kind === "text" && isRenderedMarkdownFile(filePath) && !location.lineStart;
  const effectiveContent = useMemo(() => {
    if (preview?.kind !== "text") {
      return "";
    }
    return contentOverride ?? preview.content ?? "";
  }, [contentOverride, preview]);

  const previewScrollRef = useRef<RNScrollView>(null);
  const scrollbar = useWebScrollViewScrollbar(previewScrollRef, {
    enabled: showDesktopWebScrollbar,
  });
  const horizontalScrollRef = useRef<RNScrollView>(null);
  const horizontalScrollbar = useWebScrollViewScrollbar(horizontalScrollRef, {
    enabled: showDesktopWebScrollbar,
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
    }),
    [scrollToSyncTop],
  );

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

  const highlightedLines = useMemo(() => {
    if (!preview || preview.kind !== "text" || isMarkdownFile) {
      return null;
    }

    return highlightCode(effectiveContent, filePath);
  }, [isMarkdownFile, preview, effectiveContent, filePath]);

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

  const imageSource = useMemo(
    () => (imagePreviewUri ? { uri: imagePreviewUri } : null),
    [imagePreviewUri],
  );

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
        <ActivityIndicator size="small" />
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
    if (isMarkdownFile) {
      const { frontmatter, body } = splitMarkdownFrontmatter(effectiveContent);
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
            showsVerticalScrollIndicator={!showDesktopWebScrollbar}
          >
            <View ref={syncContentRef} onPointerDown={handleSyncPointerDown}>
              {frontmatter ? (
                <View style={styles.frontmatterBlock} testID="file-pane-frontmatter">
                  <Text selectable style={styles.frontmatterText}>
                    {frontmatter}
                  </Text>
                </View>
              ) : null}
              {/* A repo document must not be able to reach the network just by being previewed. */}
              <MarkdownRenderer text={body} remoteImages="altText" />
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
          />
        ))}
      </View>
    );

    return (
      <View style={styles.previewScrollContainer}>
        <RNScrollView
          ref={previewScrollRef}
          style={styles.previewContent}
          onLayout={handleVerticalLayout}
          onScroll={handleVerticalScroll}
          onContentSizeChange={handleVerticalContentSizeChange}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={!showDesktopWebScrollbar}
        >
          {isMobile ? (
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
              showsHorizontalScrollIndicator={!showDesktopWebScrollbar}
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
    if (!svgXml && !imagePreviewUri) {
      return (
        <View style={styles.centerState}>
          <ActivityIndicator size="small" />
          <Text style={styles.loadingText}>{t("panels.file.loading")}</Text>
        </View>
      );
    }

    return (
      <View style={styles.previewScrollContainer}>
        <RNScrollView
          ref={previewScrollRef}
          style={styles.previewContent}
          contentContainerStyle={styles.previewImageScrollContent}
          onLayout={scrollbar.onLayout}
          onScroll={scrollbar.onScroll}
          onContentSizeChange={scrollbar.onContentSizeChange}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={!showDesktopWebScrollbar}
        >
          {svgXml ? (
            <NativeSvgPreview xml={svgXml} size={preview.size} />
          ) : (
            <RNImage
              source={imageSource ?? undefined}
              style={styles.previewImage}
              resizeMode="contain"
            />
          )}
        </RNScrollView>
        {scrollbar.overlay}
      </View>
    );
  }

  return (
    <View style={styles.centerState}>
      <Text style={styles.emptyText}>{t("panels.file.binaryPreviewUnavailable")}</Text>
      <Text style={styles.binaryMetaText}>{t("panels.file.binaryPreviewHint")}</Text>
      <Text style={styles.binaryMetaText}>{formatFileSize({ size: preview.size })}</Text>
    </View>
  );
}

export interface FilePreviewProps {
  serverId: string;
  workspaceRoot: string;
  location: WorkspaceFileLocation;
  /** Live buffer contents to render instead of the disk read (split view). */
  contentOverride?: string | null;
  /** Reports what kind of file the read produced (gates the editor modes). */
  onFileInfo?: (info: FilePreviewFileInfo | null) => void;
  syncRef?: React.Ref<FilePreviewSyncHandle>;
  onScrolledSync?: (metrics: PreviewScrollMetrics) => void;
  onPointerDownSync?: (pointer: PreviewPointerDown) => void;
}

export function FilePreview({
  serverId,
  workspaceRoot,
  location,
  contentOverride,
  onFileInfo,
  syncRef,
  onScrolledSync,
  onPointerDownSync,
}: FilePreviewProps) {
  const { t } = useTranslation();
  const isMobile = useIsCompactFormFactor();
  const showDesktopWebScrollbar = isWeb && !isMobile;

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
          error: null,
        };
      } catch (error) {
        return {
          file: null,
          imageAttachment: null,
          svgXml: null,
          error: error instanceof Error ? error.message : t("panels.file.failedToLoad"),
        };
      }
    },
    staleTime: 5_000,
    refetchOnMount: true,
  });
  const imagePreviewUri = useAttachmentPreviewUrl(query.data?.imageAttachment ?? null);

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

  const fileKind = query.data?.file?.kind ?? null;
  const onFileInfoRef = useRef(onFileInfo);
  onFileInfoRef.current = onFileInfo;
  useEffect(() => {
    onFileInfoRef.current?.(
      fileKind
        ? {
            kind: fileKind,
            isMarkdown: fileKind === "text" && isRenderedMarkdownFile(location.path),
          }
        : null,
    );
  }, [fileKind, location.path]);

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
        showDesktopWebScrollbar={showDesktopWebScrollbar}
        isMobile={isMobile}
        location={location}
        imagePreviewUri={imagePreviewUri}
        svgXml={query.data?.svgXml ?? null}
        contentOverride={contentOverride}
        syncRef={syncRef}
        onScrolledSync={onScrolledSync}
        onPointerDownSync={onPointerDownSync}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  return {
    container: {
      flex: 1,
      minHeight: 0,
      backgroundColor: theme.colors.surface0,
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
    previewImageScrollContent: {
      flexGrow: 1,
      padding: theme.spacing[4],
      alignItems: "center",
      justifyContent: "center",
    },
    previewImage: {
      width: "100%",
      height: 420,
    },
    previewSvg: {
      width: "100%",
      height: 420,
    },
  };
});
