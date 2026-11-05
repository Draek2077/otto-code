import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";
import { View } from "react-native";
import { FileMarkdownPreview } from "@/file-pane/markdown-preview";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { markdownNoteTargets, type MarkdownNoteTarget } from "./annotation-source";
import { DocumentNoteEditor, useDocumentNotes } from "./annotations";
export function EditorMarkdownPreview(props: ComponentProps<typeof FileMarkdownPreview>) {
  const notes = useDocumentNotes(props.filePath, props.workspaceRoot);
  const targets = useMemo(() => markdownNoteTargets(props.source), [props.source]);
  const [selected, setSelected] = useState<MarkdownNoteTarget | null>(null);
  const retained = useRetainedPanelActive(),
    visible = useAppVisible();
  useEffect(() => {
    if (!retained || !visible) setSelected(null);
  }, [retained, visible]);
  const close = useCallback(() => setSelected(null), []);
  const choose = useCallback(
    (event: { text: string }) => {
      const matches = targets.filter((target) => target.title.trim() === event.text.trim());
      if (matches.length === 1) setSelected(matches[0]);
    },
    [targets],
  );
  const items = useMemo(
    () => (notes.owned ? [{ text: "Comment on heading", onPress: choose }] : undefined),
    [notes.owned, choose],
  );
  return (
    <View>
      <FileMarkdownPreview {...props} contextMenuItems={items} />
      {selected ? (
        <DocumentNoteEditor
          key={selected.from}
          target={selected}
          initial={notes.noteFor(selected)?.note ?? ""}
          save={notes.save}
          remove={notes.remove}
          close={close}
        />
      ) : null}
    </View>
  );
}
