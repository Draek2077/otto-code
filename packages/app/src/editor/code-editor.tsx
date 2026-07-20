import { useEffect, useRef, useState, type CSSProperties } from "react";
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
  const scrollerRef = useRef<HTMLElement | null>(null);
  const scrollerContentRef = useRef<HTMLElement | null>(null);
  const [scrollerReady, setScrollerReady] = useState(false);
  const scrollbarOverlay = useWebElementScrollbar(scrollerRef, {
    enabled: scrollerReady,
    contentRef: scrollerContentRef,
    horizontal: true,
  });

  // The core mounts once per (tab, document identity); doc updates flow
  // through the controller, not through props.
  useEffect(() => {
    const parent = hostRef.current;
    if (!parent) {
      return;
    }
    let docSyncTimer: ReturnType<typeof setTimeout> | null = null;
    const core = createEditorCore({
      parent,
      path: callbacksRef.current.path,
      doc: callbacksRef.current.initialDoc,
      theme: callbacksRef.current.theme,
      wordWrap: callbacksRef.current.wordWrap,
      onDirtyChanged: (dirty) => callbacksRef.current.onDirtyChanged?.(dirty),
      onMatchInfo: (info) => callbacksRef.current.onMatchInfo?.(info),
      onSaveShortcut: () => callbacksRef.current.onSaveShortcut?.(),
      onFindShortcut: () => callbacksRef.current.onFindShortcut?.(),
      onGoToLineShortcut: () => callbacksRef.current.onGoToLineShortcut?.(),
      onScrolled: (metrics) => callbacksRef.current.onScrolled?.(metrics),
      onPointerSelect: (select) => callbacksRef.current.onPointerSelect?.(select),
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
      setDoc: (doc) => core.setDoc(doc),
      markClean: () => core.markClean(),
      setFind: (find) => core.setFind(find),
      findNext: () => core.findNext(),
      findPrevious: () => core.findPrevious(),
      replaceNext: () => core.replaceNext(),
      replaceAll: () => core.replaceAll(),
      focus: () => core.focus(),
      goToLine: (line) => core.goToLine(line),
      selectLines: (startLine, endLine) => core.selectLines(startLine, endLine),
      getScrollMetrics: () => core.getScrollMetrics(),
      scrollToFraction: (fraction) => core.scrollToFraction(fraction),
      scrollToLineAtOffset: (line, offset) => core.scrollToLineAtOffset(line, offset),
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

  return (
    // data-pmono excludes the CM6 subtree from the app-wide interface-font rule
    // (see styles/code-surface.ts) — that rule's specificity beats the CM6 theme's
    // `.cm-scroller` font-family, which would silently un-mono the whole editor.
    <div style={WRAPPER_STYLE} data-pmono="">
      <div ref={hostRef} style={HOST_STYLE} />
      {scrollbarOverlay}
    </div>
  );
}
