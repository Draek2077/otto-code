import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FileFind, FileFindModel } from "../find/index.web";
import {
  Annotation,
  Compartment,
  EditorState,
  Transaction,
  type Extension,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getLanguageForFile } from "@getpaseo/highlight";
import { getCM, vim } from "@replit/codemirror-vim";
import { isRenderedMarkdownFile } from "@/components/file-pane-render-mode";
import type { WorkspaceFileLocation } from "@/workspace/file-open";
import type { FileEditorModel } from "./model";
import { editorBaseExtensions, editorTheme, type EditorVisualTheme } from "./extensions.web";
import { editorLocationSelection } from "@/otto/editor/code/navigation"; // OTTO(editor)
import { editorFindTarget } from "@/otto/editor/code/find-bridge"; // OTTO(editor)

interface FileEditorViewProps {
  ottoExtensions?: Extension; // OTTO(editor): owned semantic extensions; the Paseo model still owns the file.
  model: FileEditorModel;
  filename: string;
  location: WorkspaceFileLocation;
  navigationRevision: number;
  vimEnabled: boolean;
  theme: EditorVisualTheme;
  onCursorChange(position: { line: number; column: number }): void;
  onVimModeChange(mode: string | null): void;
}

const languageCompartment = new Compartment();
const wrappingCompartment = new Compartment();
const themeCompartment = new Compartment();
const vimCompartment = new Compartment();
const ottoCompartment = new Compartment(); // OTTO(editor)

function wrappingForFile(filename: string) {
  return isRenderedMarkdownFile(filename) ? EditorView.lineWrapping : [];
}

export function FileEditorView({
  ottoExtensions, // OTTO(editor)
  model,
  filename,
  location,
  navigationRevision,
  vimEnabled,
  theme,
  onCursorChange,
  onVimModeChange,
}: FileEditorViewProps) {
  const [find] = useState(() => new FileFindModel());
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const snapshot = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const initial = useRef({
    filename,
    model,
    theme,
    vimEnabled,
    content: snapshot.content,
    ottoExtensions,
  }); // OTTO(editor)
  const onCursorChangeRef = useRef(onCursorChange);
  onCursorChangeRef.current = onCursorChange;

  useEffect(() => {
    if (!hostRef.current) return;
    const values = initial.current;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: values.content,
        extensions: [
          vimCompartment.of(values.vimEnabled ? vim() : []),
          ottoCompartment.of(values.ottoExtensions ?? []), // OTTO(editor)
          find.extension,
          editorFindTarget.of((editor) => {
            find.open(editor);
            return true;
          }), // OTTO(editor): registry commands use Paseo's query and focus owner.
          ...editorBaseExtensions(() => void values.model.save(), !values.ottoExtensions), // OTTO(editor)
          languageCompartment.of(getLanguageForFile(values.filename)?.extension ?? []),
          wrappingCompartment.of(wrappingForFile(values.filename)),
          themeCompartment.of(editorTheme(values.theme)),
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              !update.transactions.some((tr) => tr.annotation(remoteUpdate))
            ) {
              const { lineSeparator } = values.model.getSnapshot();
              values.model.edit(update.state.doc.sliceString(0, undefined, lineSeparator));
            }
            if (update.selectionSet || update.docChanged) {
              const head = update.state.selection.main.head;
              const line = update.state.doc.lineAt(head);
              onCursorChangeRef.current({ line: line.number, column: head - line.from + 1 });
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    onCursorChangeRef.current({ line: 1, column: 1 });
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [find]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: ottoCompartment.reconfigure(ottoExtensions ?? []) });
  }, [ottoExtensions]); // OTTO(editor): one extension seam, no parallel document/save owner.

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const document = view.state.toText(snapshot.content);
    if (view.state.doc.eq(document)) return;
    const head = Math.min(view.state.selection.main.head, document.length);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: document },
      selection: { anchor: head },
      annotations: [remoteUpdate.of(true), Transaction.addToHistory.of(false)],
    });
  }, [snapshot.content]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !location.lineStart) return;
    const selection = editorLocationSelection(view.state.doc, {
      lineStart: location.lineStart,
      lineEnd: location.lineEnd,
      columnStart: location.columnStart,
      columnEnd: location.columnEnd,
    }); // OTTO(editor)
    view.dispatch({
      selection,
      effects: EditorView.scrollIntoView(selection.anchor, { y: "center" }),
    });
  }, [
    location.lineEnd,
    location.lineStart,
    location.columnStart,
    location.columnEnd,
    navigationRevision,
  ]); // OTTO(editor)

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        languageCompartment.reconfigure(getLanguageForFile(filename)?.extension ?? []),
        wrappingCompartment.reconfigure(wrappingForFile(filename)),
      ],
    });
  }, [filename]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: themeCompartment.reconfigure(editorTheme(theme)) });
  }, [theme]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: vimCompartment.reconfigure(vimEnabled ? vim() : []) });
    if (!vimEnabled) {
      onVimModeChange(null);
      return;
    }
    const cm = getCM(view);
    if (!cm) return;
    function handleModeChange(event: { mode?: string }) {
      onVimModeChange((event.mode ?? "normal").toUpperCase());
    }
    cm.on("vim-mode-change", handleModeChange);
    onVimModeChange("NORMAL");
    return () => cm.off("vim-mode-change", handleModeChange);
  }, [onVimModeChange, vimEnabled]);

  return (
    <div style={FRAME_STYLE}>
      <div
        ref={hostRef}
        data-pmono=""
        data-otto-editor-language={isRenderedMarkdownFile(filename) ? "markdown" : "code"} // OTTO(editor): scope registry shortcuts to the focused source content.
        data-testid="file-source-editor"
        aria-label={`Source editor for ${filename}`}
        style={HOST_STYLE}
      />
      <FileFind model={find} editor={viewRef} shortcutsManaged={Boolean(ottoExtensions)} />
      {/* OTTO(editor): no hardcoded shortcut after unassignment. */}
    </div>
  );
}

const remoteUpdate = Annotation.define<boolean>();
const FRAME_STYLE = {
  display: "flex",
  position: "relative",
  flex: 1,
  minHeight: 0,
  minWidth: 0,
} as const;
// CodeMirror's scrollIntoView scrolls every overflowing ancestor and stops at a fixed or sticky
// one. Sticky (with no offsets it lays out like relative) keeps line reveals inside the editor, so
// they don't shift the host around it, such as the compact workspace sheet.
const HOST_STYLE = { flex: 1, minHeight: 0, overflow: "hidden", position: "sticky" } as const;
