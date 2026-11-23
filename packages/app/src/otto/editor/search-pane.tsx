import { useCallback, useState, useSyncExternalStore, useMemo } from "react";
import { FlatList, Text, View, type ListRenderItemInfo } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { FormTextInput } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import type { EditorSearchResult } from "@getpaseo/plugin/otto/editor";
import { EditorSearchForm } from "./search-form";
import type { EditorSearchPort } from "./workspace-ports";
import { EditorSearchNote } from "./search-note";
import { PaneContentToolbar } from "@/components/ui/pane-content-toolbar";

type Match = EditorSearchResult["matches"][number];
function MatchRow({
  item,
  surface,
  replace,
}: {
  item: Match;
  surface: EditorSearchPort;
  replace(file: string): void;
}) {
  const open = useCallback(
    () =>
      surface.navigate({
        file: item.file,
        range: {
          start: { line: item.line - 1, character: item.column - 1 },
          end: { line: item.line - 1, character: item.column - 1 + item.length },
        },
      }),
    [surface, item],
  );
  const plan = useCallback(() => replace(item.file), [replace, item.file]);
  return (
    <View style={styles.match}>
      <Button variant="ghost" size="sm" onPress={open} style={styles.open}>
        <Text style={styles.text} numberOfLines={1}>
          {item.file.split(/[\\/]/u).at(-1)}:{item.line}:{item.column}
        </Text>
        <Text style={styles.muted} numberOfLines={2}>
          {item.preview}
        </Text>
      </Button>
      <Button variant="ghost" size="xs" onPress={plan}>
        Review file replacement
      </Button>
      <EditorSearchNote surface={surface} match={item} />
    </View>
  );
}
function SearchControls({
  surface,
  model,
}: {
  surface: EditorSearchPort;
  model: EditorSearchForm;
}) {
  const draft = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const state = useSyncExternalStore(surface.subscribe, surface.getSnapshot);
  const query = useCallback((value: string) => model.edit({ query: value }), [model]);
  const replacement = useCallback((value: string) => model.replace(value), [model]);
  const include = useCallback((value: string) => model.edit({ include: value }), [model]);
  const exclude = useCallback((value: string) => model.edit({ exclude: value }), [model]);
  const caseSensitive = useCallback(
    () => model.edit({ caseSensitive: !model.getSnapshot().options.caseSensitive }),
    [model],
  );
  const wholeWord = useCallback(
    () => model.edit({ wholeWord: !model.getSnapshot().options.wholeWord }),
    [model],
  );
  const regexp = useCallback(
    () => model.edit({ regexp: !model.getSnapshot().options.regexp }),
    [model],
  );
  const search = useCallback(async () => {
    const options = model.getSnapshot().options;
    await surface.searchFiles(options);
    if (!surface.getSnapshot().error) model.searched(options);
  }, [surface, model]);
  const replaceAll = useCallback(() => {
    if (!model.stale)
      void surface.planReplace(model.getSnapshot().replacement, [
        ...new Set(surface.getSnapshot().search?.matches.map((match) => match.file)),
      ]);
  }, [surface, model]);
  return (
    <View style={styles.controls}>
      <FormTextInput
        initialValue={draft.options.query}
        onChangeText={query}
        placeholder="Find in workspace"
        accessibilityLabel="Find in workspace"
      />
      <View style={styles.row}>
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
      </View>
      <FormTextInput
        initialValue={draft.options.include}
        onChangeText={include}
        placeholder="Include glob, e.g. **/*.ts"
        accessibilityLabel="Files to include"
      />
      <FormTextInput
        initialValue={draft.options.exclude}
        onChangeText={exclude}
        placeholder="Exclude glob"
        accessibilityLabel="Files to exclude"
      />
      <Button size="sm" onPress={search} loading={state.busy} disabled={!draft.options.query}>
        Search
      </Button>
      <FormTextInput
        initialValue={draft.replacement}
        onChangeText={replacement}
        placeholder="Replace with"
        accessibilityLabel="Replace with"
      />
      <Button
        size="sm"
        variant="outline"
        onPress={replaceAll}
        disabled={model.stale || !state.search?.matches.length || state.busy}
      >
        Review replacements
      </Button>
      {state.search ? (
        <Text style={styles.muted}>
          {state.search.matches.length} matches · {state.search.scannedFiles} files checked
          {state.search.truncated ? " · Limited results; narrow the search" : ""}
          {model.stale ? " · Search again to use these options" : ""}
        </Text>
      ) : null}
    </View>
  );
}
/** One bounded scrolling surface for the form and virtualized matches. In a
 * stacked pane the form must scroll, never spill into the source below it. */
export function EditorSearchPane({ surface }: { surface: EditorSearchPort }) {
  const [model] = useState(() => new EditorSearchForm());
  const state = useSyncExternalStore(surface.subscribe, surface.getSnapshot);
  const close = useCallback(() => surface.toggleSearch(), [surface]);
  const replaceFile = useCallback(
    (file: string) => {
      if (!model.stale) void surface.planReplace(model.getSnapshot().replacement, [file]);
    },
    [surface, model],
  );
  const render = useCallback(
    ({ item }: ListRenderItemInfo<Match>) => (
      <MatchRow item={item} surface={surface} replace={replaceFile} />
    ),
    [surface, replaceFile],
  );
  const header = useMemo(
    () => <SearchControls surface={surface} model={model} />,
    [surface, model],
  );
  return (
    <View style={styles.frame} testID="editor-project-search">
      <PaneContentToolbar>
        <Text style={styles.heading}>Search in files</Text>
        <Button variant="ghost" size="xs" onPress={close}>
          Close
        </Button>
      </PaneContentToolbar>
      <FlatList
        contentContainerStyle={styles.content}
        data={state.search?.matches ?? EMPTY}
        keyExtractor={matchKey}
        renderItem={render}
        ListHeaderComponent={header}
      />
    </View>
  );
}
const EMPTY: Match[] = [];
function matchKey(match: Match) {
  return `${match.file}:${match.line}:${match.column}`;
}
const styles = StyleSheet.create((theme) => ({
  frame: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: theme.colors.surface0,
  },
  content: { padding: theme.spacing[3] },
  controls: { gap: theme.spacing[2], paddingBottom: theme.spacing[3] },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.spacing[1] },
  heading: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  text: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  match: {
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: theme.spacing[2],
  },
  open: { height: "auto", flexDirection: "column", alignItems: "flex-start" },
}));
