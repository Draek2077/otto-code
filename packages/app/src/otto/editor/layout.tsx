import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  FlatList,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { PaneContentToolbar } from "@/components/ui/pane-content-toolbar";
import { EditorRenameReview } from "./rename-review";
import type { EditorSurface, CodeLocation, EditorPanel } from "./surface";
import { EditorSearchPane } from "./search-pane";
import { MarkdownRenderer } from "@/components/markdown/renderer";

interface Row {
  id: string;
  title: string;
  detail: string;
  location: CodeLocation;
}
const panelTitles: Record<EditorPanel, string> = {
  none: "",
  references: "References",
  definitions: "Definitions",
  workspaceSymbols: "Workspace symbols",
  outline: "Outline",
  diagnostics: "Problems",
  rename: "Reviewed edits",
  hover: "Symbol information",
};
function ResultRow({ item, surface }: { item: Row; surface: EditorSurface }) {
  const open = useCallback(() => surface.navigate(item.location), [surface, item.location]);
  return (
    <Button
      variant="ghost"
      size="sm"
      onPress={open}
      style={styles.result}
      accessibilityLabel={`${item.title}, ${item.detail}`}
    >
      <View style={styles.rowText}>
        <Text style={styles.title} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.detail} numberOfLines={2}>
          {item.detail}
        </Text>
      </View>
    </Button>
  );
}
function CodeResults({ surface }: { surface: EditorSurface }) {
  const state = useSyncExternalStore(surface.subscribe, surface.getSnapshot);
  const close = useCallback(() => surface.closePanel(), [surface]);
  const rows = useMemo<Row[]>(() => {
    if (state.panel === "outline")
      return (state.result?.symbols ?? []).map((symbol, index) => ({
        id: `${symbol.name}:${index}`,
        title: `${"  ".repeat(symbol.depth)}${symbol.name}`,
        detail: symbol.detail,
        location: { file: surface.file, range: symbol.range },
      }));
    if (state.panel === "diagnostics")
      return (state.observation?.diagnostics ?? []).map((item, index) => ({
        id: `${item.source}:${index}`,
        title: item.message,
        detail: `${item.source} · ${item.range.start.line + 1}:${item.range.start.character + 1}`,
        location: { file: surface.file, range: item.range },
      }));
    return (state.result?.locations ?? []).map((location) => ({
      id: JSON.stringify(location),
      title: location.file.split(/[\\/]/u).at(-1) ?? location.file,
      detail: `${location.file}:${location.range.start.line + 1}`,
      location,
    }));
  }, [state.panel, state.result, state.observation, surface]);
  const render = useCallback(
    ({ item }: ListRenderItemInfo<Row>) => <ResultRow item={item} surface={surface} />,
    [surface],
  );
  return (
    <View style={styles.results} testID="editor-code-results">
      <PaneContentToolbar>
        <Text style={styles.heading}>{panelTitles[state.panel]}</Text>
        <Button variant="ghost" size="xs" onPress={close}>
          Close
        </Button>
      </PaneContentToolbar>
      {state.result?.source === "name-index" && (
        <Text style={styles.detail}>
          {state.result.message}
          {state.result.truncated ? " Results are limited." : ""}
        </Text>
      )}
      {state.panel === "hover" ? (
        <ScrollView>
          <MarkdownRenderer
            text={state.result?.hover ?? "No symbol information at the caret."}
            compact
            filePath={surface.file}
            serverId={surface.contextScope.hostId}
          />
        </ScrollView>
      ) : (
        <FlatList
          data={rows}
          renderItem={render}
          keyExtractor={keyForRow}
          ListEmptyComponent={emptyResults}
        />
      )}
    </View>
  );
}
function keyForRow(row: Row) {
  return row.id;
}
function emptyResults() {
  return <Text style={styles.empty}>No results</Text>;
}
export function EditorLayout({
  surface,
  children,
  footer,
}: {
  surface: EditorSurface;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const state = useSyncExternalStore(surface.subscribe, surface.getSnapshot);
  const [stacked, setStacked] = useState(useIsCompactFormFactor());
  const measure = useCallback((event: LayoutChangeEvent) => {
    if (event.nativeEvent.layout.width > 0) setStacked(event.nativeEvent.layout.width < 720);
  }, []);
  return (
    <View style={styles.frame}>
      {state.error ? (
        <Alert variant="error" size="xs">
          {state.error}
        </Alert>
      ) : null}
      <View onLayout={measure} style={[styles.split, stacked && styles.stacked]}>
        {state.searchOpen ? (
          <View style={[styles.inspector, stacked && styles.bottom]}>
            <EditorSearchPane surface={surface} />
          </View>
        ) : null}
        <View style={styles.editor}>
          {children}
          {footer}
        </View>
        {state.panel !== "none" && state.panel !== "rename" ? (
          <View style={[styles.inspector, stacked && styles.bottom]}>
            <CodeResults surface={surface} />
          </View>
        ) : null}
      </View>
      {state.panel === "rename" ? <EditorRenameReview surface={surface} /> : null}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  frame: { flex: 1, minWidth: 0, minHeight: 0 },
  split: { flex: 1, minHeight: 0, minWidth: 0, flexDirection: "row" },
  stacked: { flexDirection: "column" },
  editor: { flex: 1, minWidth: 0, minHeight: 0 },
  inspector: {
    width: 300,
    borderLeftWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  bottom: { width: "100%", height: 240, borderLeftWidth: 0, borderTopWidth: 1 },
  results: { flex: 1, minHeight: 0 },
  heading: {
    flex: 1,
    textTransform: "capitalize",
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  result: { justifyContent: "flex-start", height: "auto", minHeight: 44, borderRadius: 0 },
  rowText: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  detail: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  empty: { color: theme.colors.foregroundMuted, padding: theme.spacing[4] },
}));
