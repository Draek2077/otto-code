import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { Button } from "@/components/ui/button";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { useIsCompactFormFactor } from "@/constants/layout";
import { getOverlayRoot, useGlobalWebOverlayLayer } from "@/lib/overlay-root";
import type { ReviewSelection } from "./review-model";
import type { ReviewSurfaceProps } from "./review-surface.types";
import { reviewTextRuns, uniqueReviewSelection, type ReviewTextRun } from "./review-source";

interface MappedRun {
  node: Text;
  start: number;
  end: number;
}
function mappedRuns(root: HTMLElement, source: readonly ReviewTextRun[]) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const result: MappedRun[] = [];
  let cursor = 0;
  let node = walker.nextNode();
  while (node) {
    if (node instanceof Text && node.textContent) {
      const index = source.findIndex(
        (run, offset) => offset >= cursor && run.text === node?.textContent,
      );
      if (index >= 0) {
        result.push({ node, start: source[index].start, end: source[index].end });
        cursor = index + 1;
      }
    }
    node = walker.nextNode();
  }
  return result;
}
function sourceSelection(root: HTMLElement, range: Range, source: string): ReviewSelection | null {
  const runs = mappedRuns(root, reviewTextRuns(source));
  const start = runs.find((run) => run.node === range.startContainer);
  const end = runs.find((run) => run.node === range.endContainer);
  if (!start || !end) return uniqueReviewSelection(source, range.toString());
  const from = start.start + range.startOffset;
  const to = end.start + range.endOffset;
  return to > from ? { start: from, end: to, selectedText: source.slice(from, to) } : null;
}
interface Mark {
  id: string;
  kind: "replace" | "refine";
  left: number;
  top: number;
  width: number;
  height: number;
}
const rootStyle = { position: "relative" as const };
const header = { title: "Knowledge review note" };
function AnchoredNote({
  editor,
  close,
  anchor,
}: {
  editor: ReactNode;
  close(): void;
  anchor: { left: number; top: number };
}) {
  const compact = useIsCompactFormFactor();
  const layer = useGlobalWebOverlayLayer("floating", Boolean(editor) && !compact);
  const frame = useMemo(
    () => ({
      position: "fixed" as const,
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - 400)),
      top: Math.max(8, Math.min(anchor.top, window.innerHeight - 400)),
      width: Math.min(384, window.innerWidth - 16),
      maxHeight: "70vh",
      overflowY: "auto" as const,
      pointerEvents: "auto" as const,
      zIndex: layer,
    }),
    [anchor, layer],
  );
  const keyboard = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") close();
    },
    [close],
  );
  if (compact)
    return (
      <AdaptiveModalSheet header={header} visible={Boolean(editor)} onClose={close}>
        {editor}
      </AdaptiveModalSheet>
    );
  if (!editor) return null;
  return createPortal(
    <div role="dialog" aria-label="Knowledge review note" style={frame} onKeyDown={keyboard}>
      <View style={styles.popup}>{editor}</View>
    </div>,
    getOverlayRoot(),
  );
}
function ReviewMark({ mark, onEdit }: { mark: Mark; onEdit(id: string): void }) {
  const frame = useMemo(
    () => ({
      position: "absolute" as const,
      left: mark.left,
      top: mark.top,
      width: mark.width,
      height: mark.height,
    }),
    [mark],
  );
  const style = useMemo(
    () => [styles.mark, mark.kind === "replace" ? styles.replace : styles.refine, frame],
    [mark.kind, frame],
  );
  const edit = useCallback(() => onEdit(mark.id), [onEdit, mark.id]);
  return (
    <View style={style} pointerEvents="box-none">
      <Button
        onPress={edit}
        accessibilityLabel={`Edit ${mark.kind} note`}
        size="sm"
        variant="ghost"
      >
        {mark.kind === "replace" ? "R" : "F"}
      </Button>
    </View>
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
  const root = useRef<HTMLDivElement>(null);
  const selectedRange = useRef<Range | null>(null);
  const [selection, setSelection] = useState<ReviewSelection | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [anchor, setAnchor] = useState({ left: 16, top: 80 });
  const select = useCallback(() => {
    const current = window.getSelection();
    const element = root.current;
    if (!element || !current?.rangeCount || current.isCollapsed) return;
    const range = current.getRangeAt(0);
    if (!element.contains(range.commonAncestorContainer)) return;
    setSelection(sourceSelection(element, range, body));
    selectedRange.current = range.cloneRange();
    const rect = range.getBoundingClientRect();
    setAnchor({ left: rect.left, top: rect.bottom + 8 });
  }, [body]);
  const replace = useCallback(() => onSelection(selection, "replace"), [selection, onSelection]);
  const refine = useCallback(() => onSelection(selection, "refine"), [selection, onSelection]);
  const edit = useCallback(
    (id: string) => {
      const mark = marks.find((item) => item.id === id);
      const box = root.current?.getBoundingClientRect();
      if (mark && box)
        setAnchor({ left: box.left + mark.left, top: box.top + mark.top + mark.height + 8 });
      onEditNote(id);
    },
    [marks, onEditNote],
  );
  useEffect(() => {
    if (!editor) return;
    let frame = 0;
    const move = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = selectedRange.current?.getBoundingClientRect();
        if (rect) setAnchor({ left: rect.left, top: rect.bottom + 8 });
      });
    };
    window.addEventListener("scroll", move, true);
    window.addEventListener("resize", move);
    return () => {
      window.removeEventListener("scroll", move, true);
      window.removeEventListener("resize", move);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [editor]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const draw = () => {
      const box = element.getBoundingClientRect();
      const runs = mappedRuns(element, reviewTextRuns(body));
      const next: Mark[] = [];
      for (const note of notes) {
        const start = runs.find((run) => run.start <= note.start && run.end > note.start);
        const end = runs.find((run) => run.start < note.end && run.end >= note.end);
        if (!start || !end) continue;
        const range = document.createRange();
        range.setStart(start.node, note.start - start.start);
        range.setEnd(end.node, note.end - end.start);
        const rect = range.getBoundingClientRect();
        next.push({
          id: note.id,
          kind: note.kind,
          left: rect.left - box.left,
          top: rect.top - box.top,
          width: rect.width,
          height: rect.height,
        });
      }
      setMarks(next);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    return () => observer.disconnect();
  }, [body, notes]);
  return (
    <>
      <div
        ref={root}
        style={rootStyle}
        onPointerUp={select}
        onKeyUp={select}
        data-testid="knowledge-review-article"
      >
        <MarkdownRenderer text={body} serverId={hostId} />
        {marks.map((mark) => (
          <ReviewMark key={mark.id} mark={mark} onEdit={edit} />
        ))}
      </div>
      <View style={styles.actions}>
        <Button onPress={replace} disabled={!selection} variant="outline" size="sm">
          Replace selection
        </Button>
        <Button onPress={refine} disabled={!selection} variant="outline" size="sm">
          Refine selection
        </Button>
      </View>
      <AnchoredNote editor={editor} close={onCloseEditor} anchor={anchor} />
    </>
  );
}
const styles = StyleSheet.create((theme) => ({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  mark: { borderLeftWidth: 3, opacity: 0.7 },
  replace: { backgroundColor: theme.colors.surface2, borderLeftColor: theme.colors.accent },
  refine: { backgroundColor: theme.colors.surface3, borderLeftColor: theme.colors.statusSuccess },
  popup: {
    padding: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.borderRadius.lg,
  },
}));
