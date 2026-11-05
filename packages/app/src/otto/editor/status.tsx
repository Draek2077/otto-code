import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { getLanguageForFile } from "@getpaseo/highlight";
import type { FileEditorSnapshot, FileLineSeparator } from "@/file-pane/editor/model";
import type { EditorSurface } from "./surface";
import { editorStatusLayout } from "./status-layout";

function fileSize(size: number) {
  return size < 1024 ? `${size} B` : `${Math.round(size / 1024)} KB`;
}
const endings: Record<FileLineSeparator, string> = { "\r\n": "CRLF", "\r": "CR", "\n": "LF" };
function ProblemCount({ severity, count }: { severity: number; count: number }) {
  const style = severity === 1 ? styles.error : styles.warning;
  const label = severity === 1 ? "errors" : "warnings";
  if (severity > 2)
    return (
      <Text
        style={styles.text}
        accessibilityLabel={`${count} ${severity === 3 ? "information" : "hints"}`}
      >
        {severity === 3 ? "i" : "?"} {count}
      </Text>
    );
  return (
    <Text style={style} accessibilityLabel={`${count} ${label}`}>
      {severity === 1 ? "×" : "!"} {count}
    </Text>
  );
}
export function EditorStatus({
  snapshot,
  surface,
  filename,
  cursor,
  vimMode,
}: {
  snapshot: FileEditorSnapshot;
  surface: EditorSurface;
  filename: string;
  cursor: { line: number; column: number };
  vimMode: string | null;
}) {
  const [width, setWidth] = useState(0);
  const measure = useCallback((event: LayoutChangeEvent) => {
    if (event.nativeEvent.layout.width > 0) setWidth(event.nativeEvent.layout.width);
  }, []);
  const state = useSyncExternalStore(surface.subscribe, surface.getSnapshot);
  const layout = editorStatusLayout(width);
  const language = useMemo(() => getLanguageForFile(filename)?.name || "Plain text", [filename]);
  const counts = useMemo(() => {
    const total = new Map<number, number>();
    for (const diagnostic of state.observation?.diagnostics ?? [])
      total.set(diagnostic.severity, (total.get(diagnostic.severity) ?? 0) + 1);
    return total;
  }, [state.observation]);
  const eol = endings[snapshot.lineSeparator];
  const size = snapshot.observedVersion.status === "ready" ? snapshot.observedVersion.size : null;
  return (
    <View style={styles.bar} onLayout={measure} testID="editor-status-bar">
      <Text style={styles.language} numberOfLines={1}>
        {language}
      </Text>
      {layout.fileSize && size !== null && <Text style={styles.text}>{fileSize(size)}</Text>}
      {layout.eol && <Text style={styles.text}>{eol}</Text>}
      {layout.encoding && <Text style={styles.text}>UTF-8</Text>}
      <View style={styles.spacer} />
      {state.assetWrites > 0 ? (
        <Text style={styles.text} numberOfLines={1} accessibilityLiveRegion="polite">
          Saving image…
        </Text>
      ) : null}
      {state.observation?.servers.length ? (
        layout.severities.map((severity) => (
          <ProblemCount key={severity} severity={severity} count={counts.get(severity) ?? 0} />
        ))
      ) : (
        <Text
          style={styles.text}
          accessibilityLabel={state.diagnosticMessage ?? "Waiting for diagnostics"}
        >
          —
        </Text>
      )}
      {vimMode && <Text style={styles.text}>{vimMode}</Text>}
      <Text
        style={styles.cursor}
        accessibilityLabel={`Line ${cursor.line}, column ${cursor.column}`}
      >
        {cursor.line}:{cursor.column}
        {layout.selection && state.selection.characters > 0
          ? ` (${state.selection.characters} selected, ${state.selection.lines} lines)`
          : ""}
      </Text>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  bar: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  spacer: { flex: 1 },
  text: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  language: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, flexShrink: 1 },
  cursor: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  error: { color: theme.colors.statusDanger, fontSize: theme.fontSize.sm },
  warning: { color: theme.colors.statusWarning, fontSize: theme.fontSize.sm },
}));
