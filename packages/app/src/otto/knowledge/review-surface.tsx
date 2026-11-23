import { useCallback, useMemo, type ComponentProps } from "react";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { uniqueReviewSelection, reviewSourceBlocks } from "./review-source";
import type { ReviewSurfaceProps } from "./review-surface.types";

/** Native selection commands return a quote, never a guessed Markdown offset. */
const header = { title: "Knowledge review note" };
function SourceBlock({
  block,
  hostId,
  notes,
  onSelection,
  onEditNote,
}: Pick<ReviewSurfaceProps, "hostId" | "notes" | "onSelection" | "onEditNote"> & {
  block: ReturnType<typeof reviewSourceBlocks>[number];
}) {
  const select = useCallback(
    (text: string, kind: "replace" | "refine") => {
      const selected = uniqueReviewSelection(block.source, text);
      onSelection(
        selected
          ? { ...selected, start: selected.start + block.start, end: selected.end + block.start }
          : null,
        kind,
      );
    },
    [block, onSelection],
  );
  const replace = useCallback((event: { text: string }) => select(event.text, "replace"), [select]);
  const refine = useCallback((event: { text: string }) => select(event.text, "refine"), [select]);
  const items = useMemo<ComponentProps<typeof MarkdownRenderer>["contextMenuItems"]>(
    () => [
      { text: "Replace in Knowledge", onPress: replace },
      { text: "Refine in Knowledge", onPress: refine },
    ],
    [replace, refine],
  );
  const attached = notes.filter((note) => note.start < block.end && note.end > block.start);
  const style = useMemo(
    () => [styles.block, attached.length ? styles.marked : null],
    [attached.length],
  );
  return (
    <View style={style}>
      <MarkdownRenderer text={block.source} serverId={hostId} contextMenuItems={items} />
      {attached.map((note) => (
        <NoteMarker key={note.id} id={note.id} kind={note.kind} onEdit={onEditNote} />
      ))}
    </View>
  );
}
function NoteMarker({
  id,
  kind,
  onEdit,
}: {
  id: string;
  kind: "replace" | "refine";
  onEdit(id: string): void;
}) {
  const edit = useCallback(() => onEdit(id), [id, onEdit]);
  return (
    <Button variant="outline" size="sm" onPress={edit}>
      {kind === "replace" ? "Replace note" : "Refine note"}
    </Button>
  );
}
export function KnowledgeReviewSurface({
  body,
  hostId,
  notes,
  onSelection,
  onEditNote,
  editor,
  onCloseEditor,
}: ReviewSurfaceProps) {
  const blocks = useMemo(() => reviewSourceBlocks(body), [body]);
  return (
    <View style={styles.blocks}>
      {blocks.map((block) => (
        <SourceBlock
          key={block.start}
          block={block}
          hostId={hostId}
          notes={notes}
          onSelection={onSelection}
          onEditNote={onEditNote}
        />
      ))}
      <AdaptiveModalSheet visible={Boolean(editor)} header={header} onClose={onCloseEditor}>
        {editor}
      </AdaptiveModalSheet>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  blocks: { gap: theme.spacing[3] },
  block: {
    gap: theme.spacing[2],
    borderLeftWidth: 3,
    borderLeftColor: "transparent",
    paddingLeft: theme.spacing[2],
  },
  marked: { borderLeftColor: theme.colors.accent, backgroundColor: theme.colors.surface2 },
}));
