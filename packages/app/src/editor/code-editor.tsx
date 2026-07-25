import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useWebElementScrollbar } from "@/components/use-web-scrollbar";
import type { CodeEditorProps, EditorController } from "./editor-contract";
import { createEditorCore, type EditorCore } from "./editor-core";

// Web + Electron host: mounts the CM6 core straight into a DOM node. The raw
// <div> wrapper is the sanctioned pattern for real DOM infrastructure (see
// docs/unistyles.md); code-editor.native.tsx overrides this file on native.

const WRAPPER_STYLE: CSSProperties = {
  position: "relative",
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  width: "100%",
  height: "100%",
  overflow: "hidden",
};

const HOST_STYLE: CSSProperties = {
  width: "100%",
  height: "100%",
  overflow: "hidden",
};

const DOC_SYNC_DEBOUNCE_MS = 750;

export function CodeEditor(props: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const coreRef = useRef<EditorCore | null>(null);
  const callbacksRef = useRef(props);
  callbacksRef.current = props;

  // Web gets the same auto-hiding overlay scrollbars as the chat stream,
  // mounted on CM6's own scroller. Not gated on width: a narrow browser still
  // draws the platform's dated bar, and the overlay's container is box-none, so
  // touch scrolling passes straight through everywhere except the thin handle.
  //
  // Horizontal only. The vertical lane belongs to the overview ruler, which
  // draws its own always-visible viewport thumb over the problem marks — an
  // auto-hiding bar beside it would be a second answer to "where am I", 12px
  // further right.
  const scrollerRef = useRef<HTMLElement | null>(null);
  const scrollerContentRef = useRef<HTMLElement | null>(null);
  const [scrollerReady, setScrollerReady] = useState(false);
  const scrollbarOverlay = useWebElementScrollbar(scrollerRef, {
    enabled: scrollerReady,
    contentRef: scrollerContentRef,
    horizontal: true,
    vertical: false,
  });

  // The core mounts once per (tab, document identity); doc updates flow
  // through the controller, not through props.
  //
  // Layout effect, not a passive one: switching view mode remounts this
  // component, and a passive effect builds the CM6 DOM *after* the browser has
  // already painted the new pane — one frame of empty editor, then one of
  // unstyled scrollbar as `scrollerReady` flips. Mounting before paint means
  // the first frame the user sees is the finished editor.
  useLayoutEffect(() => {
    const parent = hostRef.current;
    if (!parent) {
      return;
    }
    let docSyncTimer: ReturnType<typeof setTimeout> | null = null;
    const core = createEditorCore({
      parent,
      path: callbacksRef.current.path,
      doc: callbacksRef.current.initialDoc,
      cleanDoc: callbacksRef.current.cleanDoc,
      theme: callbacksRef.current.theme,
      wordWrap: callbacksRef.current.wordWrap,
      // This host draws the overlay bar below, so the platform's own must never
      // paint — not even for the frame before the overlay takes over.
      hideNativeScrollbar: true,
      onDirtyChanged: (dirty) => callbacksRef.current.onDirtyChanged?.(dirty),
      onMatchInfo: (info) => callbacksRef.current.onMatchInfo?.(info),
      onCursorMoved: (position) => callbacksRef.current.onCursorMoved?.(position),
      onSaveShortcut: () => callbacksRef.current.onSaveShortcut?.(),
      onFindShortcut: () => callbacksRef.current.onFindShortcut?.(),
      onCloseFindShortcut: () => callbacksRef.current.onCloseFindShortcut?.(),
      onGoToLineShortcut: () => callbacksRef.current.onGoToLineShortcut?.(),
      onGoToDefinitionShortcut: () => callbacksRef.current.onGoToDefinitionShortcut?.(),
      onScrolled: (metrics) => callbacksRef.current.onScrolled?.(metrics),
      onPointerSelect: (select) => callbacksRef.current.onPointerSelect?.(select),
      // Only claim the right-click when the host actually has a menu: without a
      // handler the core leaves the platform menu alone.
      onContextMenu: callbacksRef.current.onContextMenu
        ? (point) => callbacksRef.current.onContextMenu?.(point)
        : undefined,
      // Same shape as the context menu: no provider, no hover extension at all.
      hoverProvider: callbacksRef.current.hoverProvider
        ? (position) =>
            callbacksRef.current.hoverProvider?.(position) ??
            Promise.resolve({ kind: "unavailable" as const })
        : undefined,
      diagnostics: callbacksRef.current.diagnostics,
      onDocChanged: () => {
        if (docSyncTimer !== null) {
          clearTimeout(docSyncTimer);
        }
        docSyncTimer = setTimeout(() => {
          docSyncTimer = null;
          const currentCore = coreRef.current;
          if (currentCore) {
            callbacksRef.current.onDocSync?.(currentCore.getDoc());
          }
        }, callbacksRef.current.docSyncDebounceMs ?? DOC_SYNC_DEBOUNCE_MS);
      },
    });
    coreRef.current = core;
    scrollerRef.current = parent.querySelector(".cm-scroller");
    scrollerContentRef.current = parent.querySelector(".cm-content");
    setScrollerReady(true);

    const controller: EditorController = {
      getDoc: () => Promise.resolve(core.getDoc()),
      getSelection: () => Promise.resolve(core.getSelection()),
      getWordAtCursor: () => Promise.resolve(core.getWordAtCursor()),
      setDoc: (doc) => core.setDoc(doc),
      setFind: (find) => core.setFind(find),
      findNext: () => core.findNext(),
      findPrevious: () => core.findPrevious(),
      replaceNext: () => core.replaceNext(),
      replaceAll: () => core.replaceAll(),
      focus: () => core.focus(),
      goToLine: (line) => core.goToLine(line),
      selectLines: (startLine, endLine, options) => core.selectLines(startLine, endLine, options),
      selectAll: () => core.selectAll(),
      replaceSelection: (text) => core.replaceSelection(text),
      getScrollMetrics: () => core.getScrollMetrics(),
      scrollToFraction: (fraction) => core.scrollToFraction(fraction),
      scrollToLineAtOffset: (line, offset) => core.scrollToLineAtOffset(line, offset),
      setDiagnostics: (diagnostics) => core.setDiagnostics(diagnostics),
    };
    callbacksRef.current.onReady?.(controller);

    return () => {
      if (docSyncTimer !== null) {
        clearTimeout(docSyncTimer);
      }
      setScrollerReady(false);
      scrollerRef.current = null;
      scrollerContentRef.current = null;
      coreRef.current = null;
      core.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme specs are rebuilt per render by uniProps mappings; only reconfigure
  // the editor when the values actually change.
  const themeKey = JSON.stringify(props.theme);
  useEffect(() => {
    coreRef.current?.setTheme(callbacksRef.current.theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeKey]);

  useEffect(() => {
    coreRef.current?.setWordWrap(props.wordWrap);
  }, [props.wordWrap]);

  // The store hands out a stable array while the set is unchanged, so this fires on a
  // real republish rather than on every keystroke that re-renders the pane.
  const diagnostics = props.diagnostics;
  useEffect(() => {
    if (diagnostics !== undefined) {
      coreRef.current?.setDiagnostics(diagnostics);
    }
  }, [diagnostics]);

  // The saved text is a prop, not a command: the buffer's baseline is the single
  // source of truth for what clean means, so a save landing or the disk version
  // being adopted reaches the editor as a new value here rather than as an
  // imperative "you are clean now" the editor would have to take on faith.
  // Skipped on mount — the core was constructed with this exact value.
  const mountedCleanDocRef = useRef(props.cleanDoc);
  useEffect(() => {
    if (props.cleanDoc === mountedCleanDocRef.current) {
      return;
    }
    mountedCleanDocRef.current = props.cleanDoc;
    coreRef.current?.setCleanDoc(props.cleanDoc);
  }, [props.cleanDoc]);

  return (
    // data-pmono excludes the CM6 subtree from the app-wide interface-font rule
    // (see styles/code-surface.ts) — that rule's specificity beats the CM6 theme's
    // `.cm-scroller` font-family, which would silently un-mono the whole editor.
    // data-testid marks the keyboard focus scope (see keyboard/focus-scope.ts):
    // it is what tells the shortcut registry that focus is in the file editor
    // rather than in some anonymous text field, so the editor's own keymap wins
    // the combos it binds.
    <div style={WRAPPER_STYLE} data-pmono="" data-testid="code-editor-surface">
      <div ref={hostRef} style={HOST_STYLE} />
      {scrollbarOverlay}
    </div>
  );
}
