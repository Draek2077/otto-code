import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { FileMarkdownPreview } from "@/file-pane/markdown-preview";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { MessageSquare, MessageSquarePlus } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { DocumentNoteEditor, useDocumentNotes } from "./annotations";
import { markdownNoteTargets, type MarkdownNoteTarget } from "./annotation-source";
const Add = withUnistyles(MessageSquarePlus),
  Saved = withUnistyles(MessageSquare);
const color = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const savedColor = (theme: Theme) => ({ color: theme.colors.accent });
interface Marker {
  target: MarkdownNoteTarget;
  top: number;
  left: number;
}
function measureMarkers(node: HTMLDivElement, targets: readonly MarkdownNoteTarget[]): Marker[] {
  const headings = [...node.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")];
  if (
    headings.length !== targets.length ||
    !headings.every(
      (heading, index) =>
        heading.tagName === `H${targets[index].level}` &&
        heading.textContent?.trim() === targets[index].title.trim(),
    )
  )
    return [];
  const bounds = node.getBoundingClientRect();
  return targets.map((target, index) => ({
    target,
    top: headings[index].getBoundingClientRect().top - bounds.top,
    left: Math.max(
      0,
      Math.min(bounds.width - 32, headings[index].getBoundingClientRect().right - bounds.left + 4),
    ),
  }));
}
function sameMarkers(previous: readonly Marker[], next: readonly Marker[]) {
  return (
    previous.length === next.length &&
    previous.every(
      (marker, index) =>
        marker.target === next[index].target &&
        marker.top === next[index].top &&
        marker.left === next[index].left,
    )
  );
}
function NoteMarker({
  marker,
  note,
  choose,
}: {
  marker: Marker;
  note?: string;
  choose(target: MarkdownNoteTarget): void;
}) {
  const press = useCallback(() => choose(marker.target), [choose, marker.target]);
  const style = useMemo(
    () => ({ position: "absolute", left: marker.left, top: marker.top, zIndex: 1 }) as const,
    [marker.top, marker.left],
  );
  return (
    <div style={style}>
      <ToolbarButton
        label={note ? "Edit document note" : "Comment on heading"}
        tooltip={note ?? "Comment on heading"}
        onPress={press}
      >
        {note ? <Saved size={14} uniProps={savedColor} /> : <Add size={14} uniProps={color} />}
      </ToolbarButton>
    </div>
  );
}
/** Overlay coordinates are measured from the existing rendered document. No
 * second renderer, source rewrite, or fragment-by-fragment Markdown parsing. */
export function EditorMarkdownPreview(props: ComponentProps<typeof FileMarkdownPreview>) {
  const root = useRef<HTMLDivElement>(null);
  const targets = useMemo(() => markdownNoteTargets(props.source), [props.source]);
  const notes = useDocumentNotes(props.filePath, props.workspaceRoot);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [selected, select] = useState<MarkdownNoteTarget | null>(null);
  const retained = useRetainedPanelActive(),
    visible = useAppVisible();
  const active = retained && visible;
  const close = useCallback(() => select(null), []);
  useEffect(() => {
    const node = root.current;
    if (!node || !active || !notes.owned) {
      setMarkers([]);
      select(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = measureMarkers(node, targets);
        setMarkers((previous) => (sameMarkers(previous, next) ? previous : next));
      });
    };
    const resize = new ResizeObserver(measure),
      mutation = new MutationObserver(measure);
    resize.observe(node);
    mutation.observe(node, { childList: true, subtree: true, characterData: true });
    measure();
    return () => {
      resize.disconnect();
      mutation.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [active, notes.owned, targets]);
  return (
    <div ref={root} style={frameStyle}>
      <FileMarkdownPreview {...props} />
      {markers.map((marker) => (
        <NoteMarker
          key={marker.target.from}
          marker={marker}
          note={notes.noteFor(marker.target)?.note}
          choose={select}
        />
      ))}
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
    </div>
  );
}
const frameStyle = { position: "relative", minWidth: 0 } as const;
