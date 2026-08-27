import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { CodeEditor } from "@/editor/code-editor";
import type { CodeEditorProps, EditorThemeSpec } from "@/editor/editor-contract";
import { buildEditorThemeSpec } from "@/editor/editor-theme";
import { Code, Eye } from "@/components/icons/material-icons";

interface KnowledgeMarkdownEditorProps {
  /** Changes only when a different Knowledge document is opened. */
  documentKey: string;
  value: string;
  onChange: (value: string) => void;
  minHeight?: number;
}

/**
 * A focused Markdown authoring surface for Knowledge forms.
 *
 * Knowledge is itself rich Markdown, so treating current truth as an ordinary
 * multi-line input makes formatting effectively undiscoverable. This keeps the
 * File Editor's CM6 surface and its live Markdown formatting, without coupling
 * a temporary Knowledge draft to the workspace-file buffer store.
 */
export function KnowledgeMarkdownEditor({
  documentKey,
  value,
  onChange,
  minHeight = 300,
}: KnowledgeMarkdownEditorProps) {
  const [formatted, setFormatted] = useState(true);
  // CodeEditor's clean document intentionally stays fixed for this mount. The
  // form owns saving, but this preserves CM6's honest dirty semantics while a
  // user edits and avoids resetting the baseline on each document sync.
  const baselineRef = useRef({ documentKey, value });
  if (baselineRef.current.documentKey !== documentKey) {
    baselineRef.current = { documentKey, value };
  }
  const accessibilityState = useMemo(() => ({ selected: formatted }), [formatted]);
  const toggleFormatted = useCallback(() => setFormatted((current) => !current), []);

  return (
    <View style={styles.shell}>
      <View style={styles.toolbar}>
        <View style={styles.toolbarCopy}>
          <Text style={styles.title}>Markdown editor</Text>
          <Text style={styles.description}>
            {formatted ? "Formatted as you type" : "Raw Markdown source"}
          </Text>
        </View>
        <Pressable
          accessibilityLabel={formatted ? "Show Markdown source" : "Show formatted Markdown"}
          accessibilityRole="button"
          accessibilityState={accessibilityState}
          onPress={toggleFormatted}
          style={modeButtonStyle}
        >
          {formatted ? <Code size={16} /> : <Eye size={16} />}
          <Text style={styles.modeButtonText}>{formatted ? "Markdown" : "Formatted"}</Text>
        </Pressable>
      </View>
      <View style={[styles.editorFrame, { height: minHeight }]}>
        <ThemedKnowledgeCodeEditor
          key={documentKey}
          path={`${documentKey}.md`}
          initialDoc={baselineRef.current.value}
          cleanDoc={baselineRef.current.value}
          wordWrap
          markdownLivePreview={formatted}
          docSyncDebounceMs={0}
          onDocSync={onChange}
        />
      </View>
    </View>
  );
}

function KnowledgeCodeEditorWithTheme({
  theme,
  ...props
}: Omit<CodeEditorProps, "theme"> & { theme?: EditorThemeSpec }) {
  if (!theme) return null;
  return <CodeEditor {...props} theme={theme} />;
}

const ThemedKnowledgeCodeEditor = withUnistyles(KnowledgeCodeEditorWithTheme, (theme) => ({
  theme: buildEditorThemeSpec(theme),
}));

const styles = StyleSheet.create((theme) => ({
  shell: {
    overflow: "hidden",
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surfaceCode,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    minHeight: 38,
    paddingHorizontal: theme.spacing[3],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  toolbarCopy: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "baseline", gap: 8 },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  description: { color: theme.colors.mutedForeground, fontSize: theme.fontSize.xs },
  modeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minHeight: 28,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
    color: theme.colors.foregroundMuted,
  },
  modeButtonPressed: { backgroundColor: theme.colors.surface2 },
  modeButtonText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  editorFrame: { minHeight: 0, backgroundColor: theme.colors.surfaceCode },
}));

function modeButtonStyle({ pressed }: { pressed: boolean }) {
  return [styles.modeButton, pressed && styles.modeButtonPressed];
}
