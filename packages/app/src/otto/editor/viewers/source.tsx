import { useEffect, useMemo, useRef, useState, useCallback, useSyncExternalStore } from "react";
import { FlatList, Text, View, type ListRenderItem } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { highlightCode, type HighlightToken } from "@getpaseo/highlight";
import { syntaxTokenStyleFor } from "@/styles/syntax-token-styles";
import type { WorkspaceFileLocation } from "@/workspace/file-open";
import type { EditorVisualTheme } from "@/file-pane/editor/extensions.web";
import { selectSourcePresentation } from "@/file-pane/source/presentation";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { EditorSearchForm } from "../search-form";
import {
  findPreviewMatches,
  splitTokensForMatches,
  type PreviewFindMatch,
  type PreviewLineMatchRange,
} from "./file-preview-find";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";

interface FileSourceViewProps {
  content: string;
  filename: string;
  location: WorkspaceFileLocation;
  navigationRevision: number;
  size: number;
  theme: EditorVisualTheme;
  tooLargeMessage: string;
}

interface SourceLine {
  number: number;
  tokens: HighlightToken[];
  ranges: PreviewLineMatchRange[];
}

export function FileSourceView({
  content,
  filename,
  location,
  navigationRevision,
  size,
  tooLargeMessage,
}: FileSourceViewProps) {
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
    />
  );
}

function VirtualizedSource({
  content,
  filename,
  location,
  navigationRevision,
  presentation,
}: Omit<FileSourceViewProps, "size" | "theme" | "tooLargeMessage"> & {
  presentation: "highlighted" | "plain";
}) {
  const listRef = useRef<FlatList<SourceLine>>(null);
  const [form] = useState(() => new EditorSearchForm());
  const draft = useSyncExternalStore(form.subscribe, form.getSnapshot);
  const [open, setOpen] = useState(false),
    [matches, setMatches] = useState<PreviewFindMatch[]>([]),
    [selected, setSelected] = useState(0);
  const active = useRetainedPanelActive(),
    visible = useAppVisible();
  const query = useCallback((value: string) => form.edit({ query: value }), [form]);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const caseSensitive = useCallback(
    () => form.edit({ caseSensitive: !form.getSnapshot().options.caseSensitive }),
    [form],
  );
  const wholeWord = useCallback(
    () => form.edit({ wholeWord: !form.getSnapshot().options.wholeWord }),
    [form],
  );
  const regexp = useCallback(
    () => form.edit({ regexp: !form.getSnapshot().options.regexp }),
    [form],
  );
  const run = useCallback(() => {
    if (!active || !visible) return;
    const options = form.getSnapshot().options;
    setMatches(findPreviewMatches(content, { ...options, search: options.query }));
    setSelected(0);
    form.searched(options);
  }, [active, visible, content, form]);
  const previous = useCallback(
    () => setSelected((value) => (value + matches.length - 1) % Math.max(matches.length, 1)),
    [matches.length],
  );
  const next = useCallback(
    () => setSelected((value) => (value + 1) % Math.max(matches.length, 1)),
    [matches.length],
  );
  useEffect(() => {
    setMatches([]);
    setSelected(0);
  }, [content]);
  const stale = form.stale;
  const ranges = useMemo(() => {
    const rows = new Map<number, PreviewLineMatchRange[]>();
    if (open && !stale)
      matches.forEach((match, index) => {
        const values = rows.get(match.line) ?? [];
        values.push({ ...match, active: index === selected });
        rows.set(match.line, values);
      });
    return rows;
  }, [matches, selected, open, stale]);
  const sourceLines = useMemo(() => {
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
  const lines = useMemo(
    () => sourceLines.map((line) => ({ ...line, ranges: ranges.get(line.number) ?? [] })),
    [sourceLines, ranges],
  );
  useEffect(() => {
    const match = matches[selected];
    if (open && active && visible && match)
      listRef.current?.scrollToIndex({ index: match.line - 1, animated: false, viewPosition: 0.5 });
  }, [matches, selected, open, active, visible]);
  useEffect(() => {
    if (!location.lineStart) return;
    listRef.current?.scrollToIndex({
      index: Math.min(location.lineStart - 1, lines.length - 1),
      animated: false,
      viewPosition: 0.5,
    });
  }, [lines.length, location.lineStart, navigationRevision]);
  return (
    <View style={styles.root}>
      <View style={styles.controls}>
        <Button size="xs" variant="ghost" onPress={toggle}>
          {open ? "Close find" : "Find in source"}
        </Button>
      </View>
      {open ? (
        <View style={styles.controls}>
          <FormTextInput
            initialValue={draft.options.query}
            onChangeText={query}
            accessibilityLabel="Find in source"
          />
          <Button
            size="xs"
            variant={draft.options.caseSensitive ? "secondary" : "ghost"}
            onPress={caseSensitive}
          >
            Match case
          </Button>
          <Button
            size="xs"
            variant={draft.options.wholeWord ? "secondary" : "ghost"}
            onPress={wholeWord}
          >
            Whole word
          </Button>
          <Button size="xs" variant={draft.options.regexp ? "secondary" : "ghost"} onPress={regexp}>
            Regex
          </Button>
          <Button size="xs" onPress={run}>
            Find
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={!matches.length || form.stale}
            onPress={previous}
          >
            Previous
          </Button>
          <Button size="xs" variant="ghost" disabled={!matches.length || form.stale} onPress={next}>
            Next
          </Button>
          <Text>
            {form.stale
              ? "Find to update results"
              : `${matches.length ? selected + 1 : 0}/${matches.length >= 1000 ? "999+" : matches.length}`}
          </Text>
        </View>
      ) : null}
      <FlatList
        ref={listRef}
        data={lines}
        keyExtractor={sourceLineKey}
        initialNumToRender={24}
        windowSize={9}
        getItemLayout={sourceLineLayout}
        renderItem={renderSourceLine}
      />
    </View>
  );
}

function SourceLineView({ line }: { line: SourceLine }) {
  let offset = 0;
  const segments = splitTokensForMatches(line.tokens, line.ranges).map((token) => {
    const from = offset;
    offset += token.text.length;
    return { text: token.text, style: token.style, highlight: token.highlight, from };
  });
  return (
    <View style={styles.line}>
      <Text style={styles.gutter}>{line.number}</Text>
      <Text selectable style={styles.text}>
        {segments.map((token) => (
          <Text
            key={`${token.from}:${token.style}`}
            style={[
              syntaxTokenStyleFor(token.style),
              token.highlight ? styles[token.highlight] : null,
            ]}
          >
            {token.text}
          </Text>
        ))}
      </Text>
    </View>
  );
}

function sourceLineKey(line: SourceLine): string {
  return String(line.number);
}

function sourceLineLayout(_data: ArrayLike<SourceLine> | null | undefined, index: number) {
  return { length: 20, offset: index * 20, index };
}

const renderSourceLine: ListRenderItem<SourceLine> = ({ item }) => <SourceLineView line={item} />;

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, minHeight: 0 },
  controls: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1],
    padding: theme.spacing[2],
  },
  match: { backgroundColor: theme.colors.terminal.selectionBackground },
  active: { backgroundColor: theme.colors.accent, color: theme.colors.accentForeground },
  unsupported: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  unsupportedText: { color: theme.colors.foregroundMuted, textAlign: "center" },
  line: { flexDirection: "row", minHeight: theme.fontSize.code * 1.45 },
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
