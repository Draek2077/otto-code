import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  HighlightStyle,
  Language,
  defineLanguageFacet,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  findNext,
  findPrevious,
  getSearchQuery,
  closeSearchPanel,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { Annotation, Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { getParserForFile } from "@otto-code/highlight";
import type {
  EditorFindState,
  EditorMatchInfo,
  EditorPointerSelect,
  EditorScrollMetrics,
  EditorThemeSpec,
} from "./editor-contract";

// The CM6 assembly shared by the web host (direct DOM mount) and the native
// webview entry. This module is bundled into the webview HTML — keep it free
// of React, React Native, and app-store imports.

export interface EditorCoreOptions {
  parent: HTMLElement;
  path: string;
  doc: string;
  theme: EditorThemeSpec;
  wordWrap: boolean;
  onDirtyChanged?: (dirty: boolean) => void;
  onMatchInfo?: (info: EditorMatchInfo | null) => void;
  onSaveShortcut?: () => void;
  onFindShortcut?: () => void;
  onGoToLineShortcut?: () => void;
  /** Fires on every doc change without content; callers pull getDoc as needed. */
  onDocChanged?: () => void;
  // Split-view scroll sync; both fire only for user-initiated interactions
  // (programmatic scrolls through the core are suppressed at the source).
  onScrolled?: (metrics: EditorScrollMetrics) => void;
  onPointerSelect?: (select: EditorPointerSelect) => void;
}

export interface EditorCoreSelection {
  text: string;
  lineStart: number;
  lineEnd: number;
  isEmpty: boolean;
}

export interface EditorCore {
  getDoc(): string;
  getSelection(): EditorCoreSelection;
  setDoc(doc: string): void;
  markClean(): void;
  setFind(find: EditorFindState | null): void;
  findNext(): void;
  findPrevious(): void;
  replaceNext(): void;
  replaceAll(): void;
  focus(): void;
  goToLine(line: number): void;
  selectLines(startLine: number, endLine: number): void;
  getScrollMetrics(): EditorScrollMetrics | null;
  scrollToFraction(fraction: number): void;
  scrollToLineAtOffset(line: number, viewportOffsetY: number): void;
  setTheme(theme: EditorThemeSpec): void;
  setWordWrap(enabled: boolean): void;
  destroy(): void;
}

// Counting stops here so a pathological query on a huge file cannot stall the
// UI; the strip renders "999+" beyond it.
const MAX_COUNTED_MATCHES = 999;

// ~4 frames (≈64ms): long enough to outlast a mount that steals focus back,
// short enough that a user cannot have deliberately clicked elsewhere yet.
const FOCUS_RETRY_FRAMES = 4;

const setDocAnnotation = Annotation.define<boolean>();

function buildThemeExtension(spec: EditorThemeSpec): Extension {
  return EditorView.theme({
    "&": {
      backgroundColor: spec.background,
      color: spec.foreground,
      fontSize: `${spec.fontSize}px`,
      height: "100%",
    },
    ".cm-scroller": {
      fontFamily: spec.fontFamily,
      lineHeight: `${spec.lineHeight}px`,
      overflow: "auto",
    },
    // Both are CM6 base-theme defaults, restated here as hard requirements:
    // the content must never end above the pane bottom (short files still
    // fill the viewport and take clicks anywhere), and the line-number
    // gutter must stay pinned left under horizontal scrolling.
    ".cm-content": {
      caretColor: spec.cursor,
      minHeight: "100%",
      boxSizing: "border-box",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: spec.cursor,
    },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor: spec.selectionBackground,
      },
    ".cm-activeLine": {
      backgroundColor: spec.activeLineBackground,
    },
    ".cm-gutters": {
      backgroundColor: spec.background,
      color: spec.gutterForeground,
      border: "none",
      borderRight: `1px solid ${spec.gutterBorder}`,
      paddingRight: "2px",
      position: "sticky",
      insetInlineStart: 0,
      minHeight: "100%",
    },
    ".cm-activeLineGutter": {
      backgroundColor: spec.activeLineBackground,
      color: spec.gutterActiveForeground,
    },
    ".cm-searchMatch": {
      backgroundColor: spec.searchMatchBackground,
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: spec.activeSearchMatchBackground,
    },
    // The find UI is the React strip; CM6's own panel stays hidden (it still
    // has to be "open" for match decorations to render).
    ".cm-panels": {
      display: "none",
    },
  });
}

// Mirrors the tag → class mapping in @otto-code/highlight's tagHighlighter so
// the editor colors agree with the read-only viewer and diff surfaces.
function buildSyntaxExtension(spec: EditorThemeSpec): Extension {
  const s = spec.syntax;
  const style = HighlightStyle.define([
    { tag: tags.keyword, color: s.keyword },
    { tag: tags.controlKeyword, color: s.keyword },
    { tag: tags.operatorKeyword, color: s.keyword },
    { tag: tags.definitionKeyword, color: s.keyword },
    { tag: tags.moduleKeyword, color: s.keyword },
    { tag: tags.comment, color: s.comment },
    { tag: tags.lineComment, color: s.comment },
    { tag: tags.blockComment, color: s.comment },
    { tag: tags.docComment, color: s.comment },
    { tag: tags.string, color: s.string },
    { tag: tags.special(tags.string), color: s.string },
    { tag: tags.number, color: s.number },
    { tag: tags.integer, color: s.number },
    { tag: tags.float, color: s.number },
    { tag: tags.bool, color: s.literal },
    { tag: tags.null, color: s.literal },
    { tag: tags.function(tags.variableName), color: s.function },
    { tag: tags.function(tags.propertyName), color: s.function },
    { tag: tags.definition(tags.variableName), color: s.definition },
    { tag: tags.definition(tags.propertyName), color: s.definition },
    { tag: tags.definition(tags.function(tags.variableName)), color: s.definition },
    { tag: tags.className, color: s.class },
    { tag: tags.definition(tags.className), color: s.class },
    { tag: tags.typeName, color: s.type },
    { tag: tags.tagName, color: s.tag },
    { tag: tags.attributeName, color: s.attribute },
    { tag: tags.attributeValue, color: s.string },
    { tag: tags.propertyName, color: s.property },
    { tag: tags.variableName, color: s.variable },
    { tag: tags.local(tags.variableName), color: s.variable },
    { tag: tags.special(tags.variableName), color: s.variable },
    { tag: tags.operator, color: s.operator },
    { tag: tags.punctuation, color: s.punctuation },
    { tag: tags.bracket, color: s.punctuation },
    { tag: tags.separator, color: s.punctuation },
    { tag: tags.regexp, color: s.regexp },
    { tag: tags.escape, color: s.escape },
    { tag: tags.meta, color: s.meta },
    { tag: tags.heading, color: s.heading },
    { tag: tags.link, color: s.link },
  ]);
  return syntaxHighlighting(style, { fallback: true });
}

function buildLanguageExtension(path: string): Extension {
  const parser = getParserForFile(path);
  if (!parser) {
    return [];
  }
  return new Language(defineLanguageFacet(), parser).extension;
}

function buildFindQuery(find: EditorFindState): SearchQuery {
  return new SearchQuery({
    search: find.search,
    replace: find.replace,
    caseSensitive: find.caseSensitive,
    wholeWord: find.wholeWord,
    regexp: find.regexp,
  });
}

export function createEditorCore(options: EditorCoreOptions): EditorCore {
  const themeCompartment = new Compartment();
  const wrapCompartment = new Compartment();
  let dirty = false;
  let findActive = false;

  const emitMatchInfo = (view: EditorView): void => {
    if (!options.onMatchInfo) {
      return;
    }
    if (!findActive) {
      options.onMatchInfo(null);
      return;
    }
    const query = getSearchQuery(view.state);
    if (!query.search || !query.valid) {
      options.onMatchInfo(null);
      return;
    }
    const { main } = view.state.selection;
    let total = 0;
    let current = 0;
    const cursor = query.getCursor(view.state) as Iterator<{ from: number; to: number }>;
    for (let step = cursor.next(); !step.done; step = cursor.next()) {
      total += 1;
      if (step.value.from === main.from && step.value.to === main.to) {
        current = total;
      }
      if (total >= MAX_COUNTED_MATCHES) {
        break;
      }
    }
    options.onMatchInfo({ current, total });
  };

  const setDirty = (next: boolean): void => {
    if (dirty === next) {
      return;
    }
    dirty = next;
    options.onDirtyChanged?.(next);
  };

  const state = EditorState.create({
    doc: options.doc,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      highlightSpecialChars(),
      drawSelection(),
      history(),
      bracketMatching(),
      search({
        createPanel: () => ({ dom: document.createElement("div") }),
      }),
      keymap.of([
        {
          key: "Mod-s",
          run: () => {
            options.onSaveShortcut?.();
            return true;
          },
        },
        {
          key: "Mod-f",
          run: () => {
            options.onFindShortcut?.();
            return true;
          },
        },
        {
          key: "Mod-g",
          run: () => {
            options.onGoToLineShortcut?.();
            return true;
          },
        },
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),
      buildLanguageExtension(options.path),
      themeCompartment.of([
        buildThemeExtension(options.theme),
        buildSyntaxExtension(options.theme),
      ]),
      wrapCompartment.of(options.wordWrap ? EditorView.lineWrapping : []),
      EditorView.updateListener.of((update) => {
        const isSetDoc = update.transactions.some((tr) => tr.annotation(setDocAnnotation));
        if (update.docChanged) {
          options.onDocChanged?.();
        }
        if (update.docChanged && !isSetDoc) {
          setDirty(true);
        }
        if (findActive && (update.docChanged || update.selectionSet)) {
          emitMatchInfo(update.view);
        }
        if (update.selectionSet && options.onPointerSelect) {
          const isPointer = update.transactions.some((tr) => tr.isUserEvent("select.pointer"));
          if (isPointer) {
            const head = update.state.selection.main.head;
            const block = update.view.lineBlockAt(head);
            options.onPointerSelect({
              line: update.state.doc.lineAt(head).number,
              lineCount: update.state.doc.lines,
              viewportOffsetY: block.top - update.view.scrollDOM.scrollTop,
            });
          }
        }
      }),
    ],
  });

  const view = new EditorView({ state, parent: options.parent });
  let destroyed = false;

  /**
   * Focus, and keep asking for a few frames.
   *
   * A single `view.focus()` is enough when the editor is already on screen, and
   * not enough when it has only just mounted: navigating to a file opens the
   * pane, mounts the editor and calls this in one pass, while the element the
   * click landed on is still being torn down — the browser hands focus back to
   * `document.body` after we asked for it. Re-asserting for a handful of frames
   * covers that without a timer that outlives the intent. It stops the instant
   * focus lands, so it cannot fight a user who clicks somewhere else.
   */
  const focusPersistently = (): void => {
    view.focus();
    if (typeof requestAnimationFrame !== "function") return;
    let attempts = 0;
    const retry = (): void => {
      if (destroyed || view.hasFocus || attempts >= FOCUS_RETRY_FRAMES) return;
      attempts += 1;
      view.focus();
      requestAnimationFrame(retry);
    };
    requestAnimationFrame(retry);
  };

  const readScrollMetrics = (): EditorScrollMetrics | null => {
    const scroller = view.scrollDOM;
    if (scroller.clientHeight <= 0) {
      return null;
    }
    const block = view.lineBlockAtHeight(scroller.scrollTop);
    return {
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      topLine: view.state.doc.lineAt(Math.min(block.from, view.state.doc.length)).number,
      lineCount: view.state.doc.lines,
    };
  };

  // Programmatic sync scrolls must not echo back as user scrolls; the flag
  // swallows exactly the one scroll event a scrollTop assignment produces.
  let suppressNextScrollEvent = false;
  const setScrollTopSuppressed = (top: number): void => {
    const scroller = view.scrollDOM;
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const clamped = Math.max(0, Math.min(top, max));
    if (Math.abs(scroller.scrollTop - clamped) < 0.5) {
      return;
    }
    suppressNextScrollEvent = true;
    scroller.scrollTop = clamped;
  };

  let scrollFrame: number | null = null;
  const handleScroll = (): void => {
    if (suppressNextScrollEvent) {
      suppressNextScrollEvent = false;
      return;
    }
    if (!options.onScrolled || scrollFrame !== null) {
      return;
    }
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null;
      const metrics = readScrollMetrics();
      if (metrics) {
        options.onScrolled?.(metrics);
      }
    });
  };
  view.scrollDOM.addEventListener("scroll", handleScroll, { passive: true });

  return {
    getDoc: () => view.state.doc.toString(),
    getSelection: () => {
      const range = view.state.selection.main;
      return {
        text: view.state.sliceDoc(range.from, range.to),
        lineStart: view.state.doc.lineAt(range.from).number,
        lineEnd: view.state.doc.lineAt(range.to).number,
        isEmpty: range.empty,
      };
    },
    setDoc: (doc) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: doc },
        annotations: setDocAnnotation.of(true),
      });
      setDirty(false);
    },
    markClean: () => {
      setDirty(false);
    },
    setFind: (find) => {
      if (!find || !find.search) {
        findActive = false;
        closeSearchPanel(view);
        options.onMatchInfo?.(null);
        return;
      }
      findActive = true;
      openSearchPanel(view);
      view.dispatch({ effects: setSearchQuery.of(buildFindQuery(find)) });
      emitMatchInfo(view);
    },
    findNext: () => {
      findNext(view);
    },
    findPrevious: () => {
      findPrevious(view);
    },
    replaceNext: () => {
      replaceNext(view);
    },
    replaceAll: () => {
      replaceAll(view);
    },
    focus: () => {
      focusPersistently();
    },
    goToLine: (line) => {
      const clamped = Math.max(1, Math.min(line, view.state.doc.lines));
      const lineInfo = view.state.doc.line(clamped);
      view.dispatch({
        selection: { anchor: lineInfo.from },
        effects: EditorView.scrollIntoView(lineInfo.from, { y: "center" }),
      });
      focusPersistently();
    },
    selectLines: (startLine, endLine) => {
      const lastLine = view.state.doc.lines;
      const from = Math.max(1, Math.min(startLine, lastLine));
      const to = Math.max(from, Math.min(endLine, lastLine));
      const fromInfo = view.state.doc.line(from);
      const toInfo = view.state.doc.line(to);
      view.dispatch({
        // Anchor at the end so the cursor sits after the span: extending or
        // typing behaves the way a drag-selection would.
        selection: { anchor: toInfo.to, head: fromInfo.from },
        effects: EditorView.scrollIntoView(fromInfo.from, { y: "center" }),
      });
      focusPersistently();
    },
    getScrollMetrics: () => readScrollMetrics(),
    scrollToFraction: (fraction) => {
      const scroller = view.scrollDOM;
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const clamped = Math.max(0, Math.min(fraction, 1));
      setScrollTopSuppressed(clamped * max);
    },
    scrollToLineAtOffset: (line, viewportOffsetY) => {
      const clamped = Math.max(1, Math.min(Math.floor(line), view.state.doc.lines));
      const block = view.lineBlockAt(view.state.doc.line(clamped).from);
      setScrollTopSuppressed(block.top - viewportOffsetY);
    },
    setTheme: (spec) => {
      view.dispatch({
        effects: themeCompartment.reconfigure([
          buildThemeExtension(spec),
          buildSyntaxExtension(spec),
        ]),
      });
    },
    setWordWrap: (enabled) => {
      view.dispatch({
        effects: wrapCompartment.reconfigure(enabled ? EditorView.lineWrapping : []),
      });
    },
    destroy: () => {
      destroyed = true;
      if (scrollFrame !== null) {
        cancelAnimationFrame(scrollFrame);
        scrollFrame = null;
      }
      view.scrollDOM.removeEventListener("scroll", handleScroll);
      view.destroy();
    },
  };
}
