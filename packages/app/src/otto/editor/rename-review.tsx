import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { View, Text, FlatList, type ListRenderItemInfo } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { structuredPatch } from "diff";
import type { EditorPlan } from "@getpaseo/plugin/otto/editor";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { DiffViewer } from "@/components/diff-viewer";
import type { DiffLine } from "@/utils/tool-call-parsers";
import { highlightDiffLines } from "@/utils/diff-highlight";
import { useIsCompactFormFactor } from "@/constants/layout";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { EditorReviewPort } from "./workspace-ports";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";

type PlannedFile = EditorPlan["files"][number];
function preview(file: PlannedFile): DiffLine[] | null {
  const patch = structuredPatch(
    file.file,
    file.file,
    file.before,
    file.after,
    undefined,
    undefined,
    { context: 3, timeout: 100 },
  );
  if (!patch) return null;
  const lines: DiffLine[] = [];
  for (const hunk of patch.hunks) {
    lines.push({
      type: "header",
      content: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    });
    for (const content of hunk.lines) {
      if (lines.length >= 10000) return null;
      let type: DiffLine["type"] = "context";
      if (content.startsWith("+")) type = "add";
      else if (content.startsWith("-")) type = "remove";
      lines.push({ type, content });
    }
  }
  return highlightDiffLines(lines, file.file);
}
function FileRow({
  file,
  selected,
  onSelect,
}: {
  file: PlannedFile;
  selected: boolean;
  onSelect(file: string): void;
}) {
  const select = useCallback(() => onSelect(file.file), [file.file, onSelect]);
  return (
    <Button
      variant={selected ? "secondary" : "ghost"}
      size="sm"
      onPress={select}
      accessibilityLabel={file.file}
    >
      <Text numberOfLines={1} style={styles.label}>
        {file.file.split(/[\\/]/u).at(-1)} · {file.editCount}
      </Text>
    </Button>
  );
}
export function EditorRenameReview({ surface }: { surface: EditorReviewPort }) {
  const retained = useRetainedPanelActive(),
    visible = useAppVisible();
  const state = useSyncExternalStore(surface.subscribe, surface.getSnapshot);
  const [selected, setSelected] = useState<string | null>(null);
  const compact = useIsCompactFormFactor();
  const file = state.plan?.files.find((entry) => entry.file === selected) ?? state.plan?.files[0];
  const lines = useMemo(() => (file ? preview(file) : null), [file]);
  const close = useCallback(() => surface.closePanel(), [surface]);
  const apply = useCallback(async () => {
    if (
      await confirmDialog({
        title: "Apply these reviewed edits?",
        message:
          "Only the reviewed plan will be applied. Files changed since review will be left unchanged.",
        confirmLabel: "Apply edits",
      })
    )
      await surface.applyRename();
  }, [surface]);
  const undo = useCallback(async () => {
    if (
      await confirmDialog({
        title: "Undo these edits?",
        message: "Files changed since this operation will be left unchanged.",
        confirmLabel: "Undo edits",
      })
    )
      await surface.undoRename();
  }, [surface]);
  const renderFile = useCallback(
    ({ item }: ListRenderItemInfo<PlannedFile>) => (
      <FileRow file={item} selected={item.file === file?.file} onSelect={setSelected} />
    ),
    [file?.file],
  );
  const header = useMemo(
    () => ({
      title: state.editLabel,
      subtitle: state.plan ? `${state.plan.files.length} files` : "Operation results",
    }),
    [state.plan, state.editLabel],
  );
  const footer = useMemo(
    () => (
      <View style={styles.actions}>
        <Button size="sm" variant="outline" onPress={close} testID="editor-review-close">
          Close
        </Button>
        {state.plan ? (
          <Button size="sm" onPress={apply} loading={state.busy} disabled={Boolean(file && !lines)}>
            Apply reviewed edits
          </Button>
        ) : null}
        {state.outcome ? (
          <Button size="sm" variant="outline" onPress={undo} loading={state.busy}>
            Undo edits
          </Button>
        ) : null}
      </View>
    ),
    [close, apply, undo, state.plan, state.outcome, state.busy, file, lines],
  );
  return (
    <AdaptiveModalSheet
      visible={retained && visible && state.panel === "rename"}
      onClose={close}
      header={header}
      footer={footer}
      desktopMaxWidth={1100}
      desktopHeight="85%"
      scrollable={false}
      testID="editor-rename-review"
    >
      {state.error ? <Alert variant="error">{state.error}</Alert> : null}
      <View style={[styles.content, compact && styles.compact]}>
        {state.plan ? (
          <View style={[styles.files, compact && styles.compactFiles]}>
            <FlatList data={state.plan.files} renderItem={renderFile} keyExtractor={fileKey} />
          </View>
        ) : null}
        <View style={styles.preview}>
          {file && lines ? <DiffViewer diffLines={lines} fillAvailableHeight /> : null}
          {file && !lines ? (
            <Alert variant="warning">
              This diff exceeded the preview time or size limit. No files were changed. Use a
              smaller rename to review it here.
            </Alert>
          ) : null}
          {state.outcome ? (
            <FlatList
              data={state.outcome.files}
              renderItem={renderOutcome}
              keyExtractor={outcomeKey}
            />
          ) : null}
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}
type Outcome = NonNullable<ReturnType<EditorReviewPort["getSnapshot"]>["outcome"]>["files"][number];
function renderOutcome({ item }: ListRenderItemInfo<Outcome>) {
  return (
    <Alert
      variant={item.state === "failed" || item.state === "conflict" ? "warning" : "success"}
      title={`${item.state}: ${item.file}`}
      description={item.message}
    />
  );
}
function outcomeKey(item: Outcome) {
  return item.file;
}
function fileKey(file: PlannedFile) {
  return file.file;
}
const styles = StyleSheet.create((theme) => ({
  content: { flex: 1, minHeight: 0, flexDirection: "row", gap: theme.spacing[3] },
  compact: { flexDirection: "column" },
  files: { width: 240 },
  compactFiles: { width: "100%", maxHeight: 160 },
  preview: { flex: 1, minHeight: 0 },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  label: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, flexShrink: 1 },
}));
