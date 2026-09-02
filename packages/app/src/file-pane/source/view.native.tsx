import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import {
  FlatList,
  Text,
  View,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { highlightCode, type HighlightToken } from "@otto-code/highlight";
import { findHighlightStyles } from "@/components/find-highlight-styles";
import { splitTokensForMatches } from "@/components/file-preview-find";
import { syntaxTokenStyleFor } from "@/styles/syntax-token-styles";
import type { WorkspaceFileLocation } from "@/workspace/file-open";
import { selectSourcePresentation } from "./presentation";
import type {
  FileSourceViewHandle,
  FileSourceViewProps,
  SourceFindMatch,
  SourceScrollMetrics,
} from "./types";

interface SourceLine {
  number: number;
  tokens: HighlightToken[];
  highlighted: boolean;
  findMatches: readonly SourceFindMatch[];
}

export const FileSourceView = forwardRef<FileSourceViewHandle, FileSourceViewProps>(
  function FileSourceView(
    {
      content,
      filename,
      location,
      navigationRevision,
      size,
      tooLargeMessage,
      findMatches = [],
      onScrolledSync,
    },
    ref,
  ) {
    const presentation = selectSourcePresentation({ size, platform: "native" });
    if (presentation === "unsupported") {
      return (
        <View style={styles.unsupported} testID="file-source-too-large">
          <Text style={styles.unsupportedText}>{tooLargeMessage}</Text>
        </View>
      );
    }
    return (
      <VirtualizedSource
        content={content}
        filename={filename}
        location={location}
        navigationRevision={navigationRevision}
        presentation={presentation}
        findMatches={findMatches}
        onScrolledSync={onScrolledSync}
        ref={ref}
      />
    );
  },
);

const VirtualizedSource = forwardRef<
  FileSourceViewHandle,
  Omit<FileSourceViewProps, "size" | "theme" | "tooLargeMessage"> & {
    presentation: "highlighted" | "plain";
  }
>(function VirtualizedSource(
  {
    content,
    filename,
    location,
    navigationRevision,
    presentation,
    findMatches = [],
    onScrolledSync,
  },
  ref,
) {
  const listRef = useRef<FlatList<SourceLine>>(null);
  const metricsRef = useRef<SourceScrollMetrics>({
    scrollTop: 0,
    contentHeight: 0,
    clientHeight: 0,
  });
  const suppressNextScrollSyncRef = useRef(false);
  const onScrolledSyncRef = useRef(onScrolledSync);
  onScrolledSyncRef.current = onScrolledSync;
  const tokenLines = useMemo(() => {
    if (presentation === "highlighted")
      return highlightCode(content, filename).map((tokens, index) => ({
        number: index + 1,
        tokens,
      }));
    return content.split("\n").map((text, index) => ({
      number: index + 1,
      tokens: [{ text, style: null }],
    }));
  }, [content, filename, presentation]);
  const lines = useMemo(() => {
    const matchesByLine = new Map<number, SourceFindMatch[]>();
    for (const match of findMatches) {
      const items = matchesByLine.get(match.line) ?? [];
      items.push(match);
      matchesByLine.set(match.line, items);
    }
    return tokenLines.map((line) => ({
      ...line,
      highlighted: isLineHighlighted(line.number, location),
      findMatches: matchesByLine.get(line.number) ?? [],
    }));
  }, [findMatches, location, tokenLines]);
  const scrollToTop = useCallback((top: number) => {
    const metrics = metricsRef.current;
    const max = Math.max(0, metrics.contentHeight - metrics.clientHeight);
    const clamped = Math.max(0, Math.min(top, max));
    if (Math.abs(clamped - metrics.scrollTop) < 0.5) return;
    suppressNextScrollSyncRef.current = true;
    metrics.scrollTop = clamped;
    listRef.current?.scrollToOffset({ offset: clamped, animated: false });
  }, []);
  useImperativeHandle(
    ref,
    () => ({
      getMetrics: () => ({ ...metricsRef.current }),
      scrollToFraction: (fraction) => {
        const metrics = metricsRef.current;
        scrollToTop(
          Math.max(0, Math.min(fraction, 1)) * (metrics.contentHeight - metrics.clientHeight),
        );
      },
      scrollToContentY: (contentY, viewportOffsetY) => scrollToTop(contentY - viewportOffsetY),
      scrollToLine: (line) => {
        const index = Math.min(Math.max(0, line - 1), Math.max(0, lines.length - 1));
        listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0 });
      },
    }),
    [lines.length, scrollToTop],
  );
  useEffect(() => {
    if (!location.lineStart) return;
    listRef.current?.scrollToIndex({
      index: Math.min(location.lineStart - 1, lines.length - 1),
      animated: false,
      viewPosition: 0.5,
    });
  }, [lines.length, location.lineStart, navigationRevision]);
  useEffect(() => {
    const active = findMatches.find((match) => match.active);
    if (active) {
      listRef.current?.scrollToIndex({
        index: Math.min(active.line - 1, Math.max(0, lines.length - 1)),
        animated: false,
        viewPosition: 0.5,
      });
    }
  }, [findMatches, lines.length]);
  const handleScrollToIndexFailed = useCallback(
    ({ index, averageItemLength }: { index: number; averageItemLength: number }) => {
      listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
      requestAnimationFrame(() => listRef.current?.scrollToIndex({ index, animated: false }));
    },
    [],
  );
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const metrics = metricsRef.current;
    metrics.scrollTop = event.nativeEvent.contentOffset.y;
    metrics.contentHeight = event.nativeEvent.contentSize.height;
    metrics.clientHeight = event.nativeEvent.layoutMeasurement.height;
    if (suppressNextScrollSyncRef.current) {
      suppressNextScrollSyncRef.current = false;
      return;
    }
    onScrolledSyncRef.current?.({ ...metrics });
  }, []);
  const handleContentSizeChange = useCallback((_width: number, height: number) => {
    metricsRef.current.contentHeight = height;
  }, []);
  const handleLayout = useCallback((event: { nativeEvent: { layout: { height: number } } }) => {
    metricsRef.current.clientHeight = event.nativeEvent.layout.height;
  }, []);
  return (
    <FlatList
      ref={listRef}
      data={lines}
      keyExtractor={sourceLineKey}
      initialNumToRender={24}
      windowSize={9}
      onScroll={handleScroll}
      onContentSizeChange={handleContentSizeChange}
      onLayout={handleLayout}
      scrollEventThrottle={16}
      onScrollToIndexFailed={handleScrollToIndexFailed}
      renderItem={renderSourceLine}
    />
  );
});

function SourceLineView({ line }: { line: SourceLine }) {
  const ranges = useMemo(
    () =>
      line.findMatches.map((match) => ({
        start: match.start,
        end: match.end,
        active: match.active,
      })),
    [line.findMatches],
  );
  const segments = useMemo(() => splitTokensForMatches(line.tokens, ranges), [line.tokens, ranges]);
  const keyedSegments = useMemo(() => {
    let offset = 0;
    return segments.map((segment) => {
      const key = `${offset}:${segment.text.length}:${segment.style ?? "plain"}`;
      offset += segment.text.length;
      return { key, segment };
    });
  }, [segments]);
  return (
    <View style={[styles.line, line.highlighted && styles.highlightedLine]}>
      <Text style={styles.gutter}>{line.number}</Text>
      <Text selectable style={styles.text}>
        {keyedSegments.map(({ key, segment }) => (
          <Text
            key={key}
            style={[
              syntaxTokenStyleFor(segment.style),
              segment.highlight === "active" && findHighlightStyles.active,
              segment.highlight === "match" && findHighlightStyles.match,
            ]}
          >
            {segment.text}
          </Text>
        ))}
      </Text>
    </View>
  );
}

function sourceLineKey(line: SourceLine): string {
  return String(line.number);
}

function isLineHighlighted(line: number, location: WorkspaceFileLocation): boolean {
  if (!location.lineStart || location.lineStart <= 0) return false;
  const lastLine =
    location.lineEnd && location.lineEnd >= location.lineStart
      ? location.lineEnd
      : location.lineStart;
  return line >= location.lineStart && line <= lastLine;
}

const renderSourceLine: ListRenderItem<SourceLine> = ({ item }) => <SourceLineView line={item} />;

const styles = StyleSheet.create((theme) => ({
  unsupported: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  unsupportedText: { color: theme.colors.foregroundMuted, textAlign: "center" },
  line: { flexDirection: "row", minHeight: theme.fontSize.code * 1.45 },
  highlightedLine: { backgroundColor: theme.colors.terminal.selectionBackground },
  gutter: {
    width: 56,
    paddingRight: theme.spacing[3],
    textAlign: "right",
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
  },
  text: {
    flex: 1,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    lineHeight: theme.fontSize.code * 1.45,
  },
}));
