import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { Decoration, EditorView, lineNumbers } from "@codemirror/view";
import { getLanguageForFile } from "@otto-code/highlight";
import type { WorkspaceFileLocation } from "@/workspace/file-open";
import type { EditorVisualTheme } from "../editor/extensions.web";
import { editorTheme } from "../editor/extensions.web";
import { selectSourcePresentation, type SourcePresentation } from "./presentation";
import type {
  FileSourceViewHandle,
  FileSourceViewProps,
  SourceFindMatch,
  SourceScrollMetrics,
} from "./types";

const languageCompartment = new Compartment();
const themeCompartment = new Compartment();
const lineHighlightCompartment = new Compartment();
const findHighlightCompartment = new Compartment();
const wrappingCompartment = new Compartment();

export const FileSourceView = forwardRef<FileSourceViewHandle, FileSourceViewProps>(
  function FileSourceView(
    {
      content,
      filename,
      location,
      navigationRevision,
      size,
      theme,
      tooLargeMessage,
      findMatches = [],
      wrapLines = false,
      onScrolledSync,
      onPointerDownSync,
    },
    ref,
  ) {
    const presentation = selectSourcePresentation({ size, platform: "web" });
    if (presentation === "unsupported") {
      return (
        <div data-testid="file-source-too-large" style={UNSUPPORTED_STYLE}>
          {tooLargeMessage}
        </div>
      );
    }
    return (
      <ReadonlyCodeMirror
        content={content}
        filename={filename}
        location={location}
        navigationRevision={navigationRevision}
        presentation={presentation}
        theme={theme}
        findMatches={findMatches}
        wrapLines={wrapLines}
        onScrolledSync={onScrolledSync}
        onPointerDownSync={onPointerDownSync}
        ref={ref}
      />
    );
  },
);

const ReadonlyCodeMirror = forwardRef<
  FileSourceViewHandle,
  Omit<FileSourceViewProps, "size" | "tooLargeMessage"> & {
    presentation: Exclude<SourcePresentation, "unsupported">;
  }
>(function ReadonlyCodeMirror(
  {
    content,
    filename,
    location,
    navigationRevision,
    presentation,
    theme,
    findMatches = [],
    wrapLines = false,
    onScrolledSync,
    onPointerDownSync,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const syncMetricsRef = useRef<SourceScrollMetrics>({
    scrollTop: 0,
    contentHeight: 0,
    clientHeight: 0,
  });
  const suppressNextScrollSyncRef = useRef(false);
  const onScrolledSyncRef = useRef(onScrolledSync);
  onScrolledSyncRef.current = onScrolledSync;
  const onPointerDownSyncRef = useRef(onPointerDownSync);
  onPointerDownSyncRef.current = onPointerDownSync;
  const initial = useRef({ content, filename, location, presentation, theme, wrapLines });

  const readMetrics = useCallback(() => {
    const scroller = viewRef.current?.scrollDOM;
    if (!scroller) return syncMetricsRef.current;
    const metrics = syncMetricsRef.current;
    metrics.scrollTop = scroller.scrollTop;
    metrics.contentHeight = scroller.scrollHeight;
    metrics.clientHeight = scroller.clientHeight;
    return metrics;
  }, []);

  const scrollToTop = useCallback(
    (top: number) => {
      const scroller = viewRef.current?.scrollDOM;
      if (!scroller) return;
      const metrics = readMetrics();
      const max = Math.max(0, metrics.contentHeight - metrics.clientHeight);
      const clamped = Math.max(0, Math.min(top, max));
      if (Math.abs(clamped - metrics.scrollTop) < 0.5) return;
      suppressNextScrollSyncRef.current = true;
      scroller.scrollTop = clamped;
      metrics.scrollTop = clamped;
    },
    [readMetrics],
  );

  useImperativeHandle(
    ref,
    () => ({
      getMetrics: () => ({ ...readMetrics() }),
      scrollToFraction: (fraction) => {
        const metrics = readMetrics();
        scrollToTop(
          Math.max(0, Math.min(fraction, 1)) * (metrics.contentHeight - metrics.clientHeight),
        );
      },
      scrollToContentY: (contentY, viewportOffsetY) => scrollToTop(contentY - viewportOffsetY),
      scrollToLine: (line) => {
        const view = viewRef.current;
        if (!view) return;
        const target = Math.min(Math.max(1, line), view.state.doc.lines);
        view.dispatch({
          effects: EditorView.scrollIntoView(view.state.doc.line(target).from, { y: "start" }),
        });
      },
    }),
    [readMetrics, scrollToTop],
  );

  useEffect(() => {
    if (!hostRef.current) return;
    const values = initial.current;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: values.content,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          languageCompartment.of(
            languageFor({ filename: values.filename, presentation: values.presentation }),
          ),
          themeCompartment.of(sourceTheme(values.theme)),
          lineNumbers(),
          lineHighlightCompartment.of(EditorView.decorations.of(Decoration.none)),
          findHighlightCompartment.of(EditorView.decorations.of(Decoration.none)),
          wrappingCompartment.of(values.wrapLines ? EditorView.lineWrapping : []),
        ],
      }),
    });
    view.dispatch({
      effects: lineHighlightCompartment.reconfigure(
        lineHighlightExtension(view.state, values.location),
      ),
    });
    viewRef.current = view;
    const handleScroll = () => {
      const metrics = readMetrics();
      if (suppressNextScrollSyncRef.current) {
        suppressNextScrollSyncRef.current = false;
        return;
      }
      onScrolledSyncRef.current?.({ ...metrics });
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!onPointerDownSyncRef.current) return;
      const metrics = readMetrics();
      const bounds = view.scrollDOM.getBoundingClientRect();
      const viewportOffsetY = event.clientY - bounds.top;
      onPointerDownSyncRef.current({
        contentY: metrics.scrollTop + viewportOffsetY,
        viewportOffsetY,
        contentHeight: metrics.contentHeight,
      });
    };
    view.scrollDOM.addEventListener("scroll", handleScroll, { passive: true });
    view.scrollDOM.addEventListener("pointerdown", handlePointerDown);
    return () => {
      view.scrollDOM.removeEventListener("scroll", handleScroll);
      view.scrollDOM.removeEventListener("pointerdown", handlePointerDown);
      view.destroy();
      viewRef.current = null;
    };
  }, [readMetrics]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === content) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
  }, [content]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        languageCompartment.reconfigure(languageFor({ filename, presentation })),
        themeCompartment.reconfigure(sourceTheme(theme)),
      ],
    });
  }, [filename, presentation, theme]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wrappingCompartment.reconfigure(wrapLines ? EditorView.lineWrapping : []),
    });
  }, [wrapLines]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const effects = [
      lineHighlightCompartment.reconfigure(lineHighlightExtension(view.state, location)),
      findHighlightCompartment.reconfigure(findHighlightExtension(view.state, findMatches)),
    ];
    if (location.lineStart) {
      const line = Math.min(location.lineStart, view.state.doc.lines);
      effects.push(EditorView.scrollIntoView(view.state.doc.line(line).from, { y: "center" }));
    }
    view.dispatch({ effects });
  }, [findMatches, location, navigationRevision]);

  useEffect(() => {
    const active = findMatches.find((match) => match.active);
    const view = viewRef.current;
    if (!view || !active || active.line < 1 || active.line > view.state.doc.lines) return;
    view.dispatch({
      effects: EditorView.scrollIntoView(view.state.doc.line(active.line).from, { y: "center" }),
    });
  }, [findMatches]);

  return <div ref={hostRef} data-testid="file-source-editor" style={HOST_STYLE} />;
});

function sourceTheme(theme: EditorVisualTheme) {
  return [
    editorTheme(theme),
    EditorView.theme({
      "& .cm-file-source-line-highlight": { backgroundColor: theme.selection },
      "& .cm-file-source-find-match": { backgroundColor: theme.selection },
      "& .cm-file-source-find-active": { outline: `1px solid ${theme.foreground}` },
    }),
  ];
}

function lineHighlightExtension(state: EditorState, location: WorkspaceFileLocation) {
  if (!location.lineStart || location.lineStart <= 0) {
    return EditorView.decorations.of(Decoration.none);
  }
  const firstLine = Math.min(Math.floor(location.lineStart), state.doc.lines);
  const requestedLastLine =
    location.lineEnd && location.lineEnd >= location.lineStart
      ? Math.floor(location.lineEnd)
      : firstLine;
  const lastLine = Math.min(requestedLastLine, state.doc.lines);
  const decoration = Decoration.line({ attributes: { class: "cm-file-source-line-highlight" } });
  const ranges = [];
  for (let line = firstLine; line <= lastLine; line += 1) {
    ranges.push(decoration.range(state.doc.line(line).from));
  }
  return EditorView.decorations.of(Decoration.set(ranges, true));
}

function findHighlightExtension(state: EditorState, matches: readonly SourceFindMatch[]) {
  const match = Decoration.mark({ attributes: { class: "cm-file-source-find-match" } });
  const active = Decoration.mark({
    attributes: { class: "cm-file-source-find-match cm-file-source-find-active" },
  });
  const ranges = matches.flatMap((item) => {
    if (item.line < 1 || item.line > state.doc.lines || item.start < 0 || item.end <= item.start) {
      return [];
    }
    const line = state.doc.line(item.line);
    const from = Math.min(line.to, line.from + item.start);
    const to = Math.min(line.to, line.from + item.end);
    return to > from ? [(item.active ? active : match).range(from, to)] : [];
  });
  return EditorView.decorations.of(Decoration.set(ranges, true));
}

function languageFor(input: {
  filename: string;
  presentation: Exclude<SourcePresentation, "unsupported">;
}) {
  return input.presentation === "highlighted"
    ? (getLanguageForFile(input.filename)?.extension ?? [])
    : [];
}

const HOST_STYLE = { flex: 1, minHeight: 0, overflow: "hidden" } as const;
const UNSUPPORTED_STYLE = {
  alignItems: "center",
  display: "flex",
  flex: 1,
  justifyContent: "center",
} as const;
