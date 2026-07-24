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
import { Annotation, Compartment, EditorState, Text, type Extension } from "@codemirror/state";
import {
  type BlockInfo,
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
  EditorCursorPosition,
  EditorFindState,
  EditorMatchInfo,
  EditorPointerSelect,
  EditorScrollMetrics,
  EditorThemeSpec,
} from "./editor-contract";
import { findWordAtCursor } from "./word-at-cursor";

// The CM6 assembly shared by the web host (direct DOM mount) and the native
// webview entry. This module is bundled into the webview HTML — keep it free
// of React, React Native, and app-store imports.

export interface EditorCoreOptions {
  parent: HTMLElement;
  path: string;
  doc: string;
  /**
   * The text that counts as saved. Defaults to `doc`; differs from it only when
   * the host mounts a recovered draft (a remount or webview crash with unsaved
   * edits), where the document is the draft and the baseline is what is on disk.
   */
  cleanDoc?: string;
  theme: EditorThemeSpec;
  wordWrap: boolean;
  onDirtyChanged?: (dirty: boolean) => void;
  onMatchInfo?: (info: EditorMatchInfo | null) => void;
  onCursorMoved?: (position: EditorCursorPosition) => void;
  onSaveShortcut?: () => void;
  onFindShortcut?: () => void;
  onGoToLineShortcut?: () => void;
  onGoToDefinitionShortcut?: () => void;
  /** Fires on every doc change without content; callers pull getDoc as needed. */
  onDocChanged?: () => void;
  // Split-view scroll sync; both fire only for user-initiated interactions
  // (programmatic scrolls through the core are suppressed at the source).
  onScrolled?: (metrics: EditorScrollMetrics) => void;
  onPointerSelect?: (select: EditorPointerSelect) => void;
  /**
   * A right-click landed in the editor, reported in viewport coordinates so the
   * host can anchor its own menu. Supplying this SUPPRESSES the platform menu —
   * the host is then responsible for offering the edit actions (see
   * file-tab-pane's editor context menu).
   */
  onContextMenu?: (point: { x: number; y: number }) => void;
  /**
   * Hide the platform's own scrollbar on the editor's scroller. Set by hosts
   * that draw the app's auto-hiding overlay bar instead (web/desktop). It is a
   * THEME rule rather than something the overlay hook switches on after mount:
   * an imperative hide only lands on the second frame, so remounting the editor
   * — which is what switching to split or preview does — flashed the platform
   * bar for a frame first. Off by default so the native webview keeps the
   * touch scroll indicator it has no overlay to replace.
   */
  hideNativeScrollbar?: boolean;
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
  getWordAtCursor(): string;
  setDoc(doc: string): void;
  /** Declare `doc` the saved text and re-derive dirty from the live document. */
  setCleanDoc(doc: string): void;
  setFind(find: EditorFindState | null): void;
  findNext(): void;
  findPrevious(): void;
  replaceNext(): void;
  replaceAll(): void;
  focus(): void;
  goToLine(line: number): void;
  selectLines(startLine: number, endLine: number, options?: { reveal?: boolean }): void;
  selectAll(): void;
  replaceSelection(text: string): void;
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

// `.cm-line`'s left padding, restated below as a hard requirement because the
// ruler stripe is positioned from the line box's origin and has to land on the
// same x as the first character.
const LINE_PADDING_LEFT_PX = 6;

// The line-length ruler is a 1px background stripe rather than a decoration or
// an overlay element: no extra DOM, no per-line cost, and it paints behind the
// text for free. `ch` is the advance width of "0" — exact for a mono stack, and
// it rescales with the code font size on its own.
//
// The stripe only spans the content box, which is max(longest line, viewport):
// past that edge there is nothing to scroll to, so a ruler that isn't drawn is
// also one the user could never have reached.
function rulerBackground(spec: EditorThemeSpec): Record<string, string> {
  if (spec.rulerColumn === null) {
    return {};
  }
  const edge = `calc(${LINE_PADDING_LEFT_PX}px + ${spec.rulerColumn}ch)`;
  return {
    backgroundImage: `linear-gradient(to right, transparent calc(${edge} - 1px), ${spec.rulerColor} calc(${edge} - 1px), ${spec.rulerColor} ${edge}, transparent ${edge})`,
    backgroundRepeat: "no-repeat",
  };
}

// Column is 1-based and counted in UTF-16 code units — the same unit CM6 uses
// for offsets, so it always agrees with what the editor itself considers a
// position. (An astral emoji therefore advances the column by 2; matching CM6
// beats matching an abstract notion of "character" the editor doesn't share.)
function readCursorPosition(state: EditorState): EditorCursorPosition {
  const range = state.selection.main;
  const line = state.doc.lineAt(range.head);
  return {
    line: line.number,
    column: range.head - line.from + 1,
    selectedChars: range.to - range.from,
    selectedLines: range.empty
      ? 0
      : state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number + 1,
  };
}

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
      ...rulerBackground(spec),
    },
    // CM6 base-theme default, restated so LINE_PADDING_LEFT_PX stays true.
    ".cm-line": {
      paddingLeft: `${LINE_PADDING_LEFT_PX}px`,
      paddingRight: "2px",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: spec.cursor,
      borderLeftWidth: `${spec.cursorWidth}px`,
    },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor: spec.selectionBackground,
      },
    // The stripe is the line box itself — a plain background on `.cm-line`, the
    // way CM6 ships it. That is what keeps it exactly the height of the row and
    // exactly in step with the gutter: it IS the row, rather than a rectangle
    // computed to match one.
    //
    // The catch is that `drawSelection` renders into `.cm-selectionLayer` at a
    // NEGATIVE z-index — behind the content — so an OPAQUE line background hides
    // the selection on the caret's line completely. `activeLineBackground` is
    // therefore translucent (see editor-theme.ts), which is exactly why CM6's own
    // default is `#cceeff44`. Keep it translucent: an opaque value here silently
    // eats the selection, and moving the stripe into its own layer to dodge that
    // is what broke the alignment (both were tried; see docs/text-editor.md).
    //
    // The ruler needs no redraw here for the same reason — the gradient on
    // `.cm-content` shows through.
    ".cm-activeLine": {
      backgroundColor: spec.activeLineBackground,
    },
    ".cm-gutters": {
      backgroundColor: spec.gutterBackground,
      color: spec.gutterForeground,
      border: "none",
      borderRight: `1px solid ${spec.gutterBorder}`,
      paddingRight: "2px",
      position: "sticky",
      insetInlineStart: 0,
      minHeight: "100%",
      // The numbers are a control, not text: plain arrow pointer, and nothing to
      // highlight. `handleLineNumberMouseDown` already blocks the drag that would
      // start a selection; this is what stops it reading as selectable text.
      cursor: "default",
      userSelect: "none",
      WebkitUserSelect: "none",
    },
    ".cm-activeLineGutter": {
      backgroundColor: spec.activeLineBackground,
      color: spec.gutterActiveForeground,
    },
    // Outline, not border: an inline mark spanning a match must not add width
    // and reflow the line under it. `borderRadius` rounds the fill; the outline
    // is what makes a hit findable when the fill lands on a saturated syntax
    // color. The active hit is deliberately a big step up, not a nudge — this
    // is the "which one am I on" signal while stepping through results.
    ".cm-searchMatch": {
      backgroundColor: spec.searchMatchBackground,
      outline: `1px solid ${spec.searchMatchBorder}`,
      borderRadius: "2px",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: spec.activeSearchMatchBackground,
      outline: `2px solid ${spec.activeSearchMatchBorder}`,
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
// Static, so it costs nothing to keep mounted: both properties are needed
// because Firefox reads `scrollbar-width` and Chromium/WebKit the pseudo-
// element. See `hideNativeScrollbar` for why this is a theme and not a hook.
const hiddenScrollbarTheme = EditorView.theme({
  ".cm-scroller": {
    scrollbarWidth: "none",
  },
  ".cm-scroller::-webkit-scrollbar": {
    display: "none",
    width: "0",
    height: "0",
  },
});

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

// Clicking a line number is a "go here" gesture, not a selection one: the caret
// lands on that line keeping the column it was already in, clamped to the end of
// the line when that line is shorter. That is what makes a run of gutter clicks
// read as vertical movement rather than as a jump to column 1 every time.
//
// mousedown, not click, so it lands before the browser starts a drag-selection
// over the gutter text — and `preventDefault` keeps that drag from starting at
// all, which is why the numbers stay unselectable without a selection-clearing
// hack. Scrolling is deliberately left alone: the line was on screen, the user
// just clicked it.
function handleLineNumberMouseDown(view: EditorView, block: BlockInfo, event: Event): boolean {
  const mouse = event as MouseEvent;
  if (mouse.button !== 0) {
    return false;
  }
  const { state } = view;
  const head = state.selection.main.head;
  const column = head - state.doc.lineAt(head).from;
  const target = state.doc.lineAt(block.from);
  view.dispatch({
    selection: { anchor: Math.min(target.from + column, target.to) },
    userEvent: "select.pointer",
  });
  view.focus();
  mouse.preventDefault();
  return true;
}

export function createEditorCore(options: EditorCoreOptions): EditorCore {
  const themeCompartment = new Compartment();
  const wrapCompartment = new Compartment();
  let findActive = false;

  // Dirty is a COMPARISON against the saved text, not a latch on "an edit
  // happened". Any edit that leaves the document equal to that text is not a
  // modification, however it got there — undo, redo, a cut whose paste puts it
  // back, retyping the character you just deleted. Latching on the first
  // docChanged left Save and Revert armed against a file that no longer
  // differed from disk.
  //
  // `cleanDoc` is a Text, not a string, because `Text.eq` is the cheap
  // primitive for a per-keystroke check: it rejects on length or line count
  // first (O(1) for ordinary typing) and then prunes the subtrees CM6's rope
  // shares between two near-identical documents, so a full character walk is
  // reached only for an equal-length edit — exactly the case that might be a
  // return to clean. That pruning is why the baseline reuses `state.doc` when
  // the two start out identical rather than building a second, unrelated rope.
  let cleanDoc: Text;
  let dirty = false;

  const emitDirty = (next: boolean, force: boolean): void => {
    if (dirty === next && !force) {
      return;
    }
    dirty = next;
    options.onDirtyChanged?.(next);
  };

  const reconcileDirty = (doc: Text, force = false): void => {
    emitDirty(!doc.eq(cleanDoc), force);
  };

  // A new baseline always reports, even when the answer is unchanged: the host
  // sets one at moments (a save landed, the disk version was adopted) where its
  // own dirty flag may already have moved, and this is what puts the two back
  // in agreement.
  const adoptCleanDoc = (baseline: Text): void => {
    cleanDoc = baseline;
    reconcileDirty(view.state.doc, true);
  };

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

  // Reveal the primary selection by scrolling to its ACTUAL rendered position.
  //
  // Why not CM6's own `scrollIntoView`: in this embedded editor CM6's scroll
  // pass lands the scroller at the wrong offset — measured at ~175px (≈10 lines)
  // past a search match, with no scrollable ancestor involved, so it is CM6's
  // height-map estimate for the jump, not a feedback loop. It also does not
  // self-correct, so the target sits just out of view. This bit both typing at
  // an off-screen caret and stepping through search matches.
  //
  // `coordsAtPos` returns the target's real DOM rectangle (ground truth,
  // independent of the height map) once the line is rendered — which it is after
  // CM6's own pass, since CM6 lands close enough to render the region. We read
  // that rect on the next frame and nudge `.cm-scroller` directly (via
  // `setScrollTopSuppressed`, which also keeps split-view sync from echoing) so
  // the target sits a comfortable margin inside the viewport. A no-op when it is
  // already within that band, so it never fights the user mid-type. Falls back
  // to the height map only when the line is somehow unrendered (a very far jump).
  let revealFrame: number | null = null;
  const revealSelectionInView = (v: EditorView): void => {
    const scroller = v.scrollDOM;
    if (scroller.clientHeight <= 0) {
      return;
    }
    const head = v.state.selection.main.head;
    const coords = v.coordsAtPos(head);
    const margin = Math.min(80, scroller.clientHeight / 4);
    if (!coords) {
      const block = v.lineBlockAt(head);
      setScrollTopSuppressed(block.top - margin);
      return;
    }
    const rect = scroller.getBoundingClientRect();
    let delta = 0;
    if (coords.top < rect.top + margin) {
      delta = coords.top - (rect.top + margin);
    } else if (coords.bottom > rect.bottom - margin) {
      delta = coords.bottom - (rect.bottom - margin);
    }
    if (Math.abs(delta) > 0.5) {
      setScrollTopSuppressed(scroller.scrollTop + delta);
    }
  };
  const scheduleReveal = (v: EditorView): void => {
    if (typeof requestAnimationFrame !== "function" || revealFrame !== null) {
      return;
    }
    revealFrame = requestAnimationFrame(() => {
      revealFrame = null;
      if (!destroyed) {
        revealSelectionInView(v);
      }
    });
  };

  const state = EditorState.create({
    doc: options.doc,
    extensions: [
      lineNumbers({ domEventHandlers: { mousedown: handleLineNumberMouseDown } }),
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
        // Both bindings, because muscle memory splits: Mod-B is JetBrains, F12
        // is VS Code. Neither is claimed by defaultKeymap.
        {
          key: "Mod-b",
          run: () => {
            options.onGoToDefinitionShortcut?.();
            return true;
          },
        },
        {
          key: "F12",
          run: () => {
            options.onGoToDefinitionShortcut?.();
            return true;
          },
        },
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),
      // Right-click is a "act on what I am pointing at" gesture, so the caret
      // moves to the click before the menu opens — unless the click landed
      // inside an existing selection, which the user is pointing at on purpose.
      // Without this, "Go to Definition" would run on wherever the caret
      // happened to be, not on the word under the pointer.
      EditorView.domEventHandlers({
        contextmenu: (event, v) => {
          if (!options.onContextMenu) {
            return false;
          }
          const pos = v.posAtCoords({ x: event.clientX, y: event.clientY });
          const { main } = v.state.selection;
          if (pos !== null && (main.empty || pos < main.from || pos > main.to)) {
            v.dispatch({ selection: { anchor: pos }, userEvent: "select.pointer" });
          }
          v.focus();
          options.onContextMenu({ x: event.clientX, y: event.clientY });
          event.preventDefault();
          return true;
        },
      }),
      buildLanguageExtension(options.path),
      themeCompartment.of([
        buildThemeExtension(options.theme),
        buildSyntaxExtension(options.theme),
      ]),
      wrapCompartment.of(options.wordWrap ? EditorView.lineWrapping : []),
      options.hideNativeScrollbar ? hiddenScrollbarTheme : [],
      EditorView.updateListener.of((update) => {
        const isSetDoc = update.transactions.some((tr) => tr.annotation(setDocAnnotation));
        if (update.docChanged) {
          options.onDocChanged?.();
        }
        if (update.docChanged && !isSetDoc) {
          reconcileDirty(update.state.doc);
          scheduleReveal(update.view);
        }
        if (findActive && (update.docChanged || update.selectionSet)) {
          emitMatchInfo(update.view);
        }
        if (update.selectionSet || update.docChanged) {
          options.onCursorMoved?.(readCursorPosition(update.state));
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

  // Reuse the document's own rope as the baseline in the ordinary case (nothing
  // recovered, so the two are the same text) — see the `cleanDoc` note above.
  // A recovered draft starts out genuinely dirty, and the host is told so rather
  // than left to infer it from its own restore path.
  cleanDoc =
    options.cleanDoc == null || options.cleanDoc === options.doc
      ? state.doc
      : Text.of(options.cleanDoc.split("\n"));
  reconcileDirty(state.doc);

  // The listener only fires on change, so the status bar would read blank until
  // the first keystroke without this.
  options.onCursorMoved?.(readCursorPosition(view.state));

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
    // Read from the selection HEAD, not `from`: after a shift-arrow selection
    // the head is where the user thinks the caret is.
    getWordAtCursor: () => {
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      return findWordAtCursor(line.text, head - line.from + 1);
    },
    setDoc: (doc) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: doc },
        annotations: setDocAnnotation.of(true),
      });
      // setDoc only ever installs a known-saved document (revert, reload from
      // disk), so the text it just wrote is the new baseline — and reusing the
      // rope it produced keeps later comparisons on the cheap path.
      adoptCleanDoc(view.state.doc);
    },
    setCleanDoc: (doc) => {
      // Same rope-sharing trick, for the case that matters most: a save landing
      // on a document nobody has touched since it was written.
      const live = view.state.doc;
      const sameAsLive = doc.length === live.length && doc === live.toString();
      adoptCleanDoc(sameAsLive ? live : Text.of(doc.split("\n")));
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
    // CM6's own scroll-to-match lands the scroller at the wrong offset here (see
    // revealSelectionInView), so re-reveal the match by its real position on the
    // next frame, after CM6 has moved the selection and rendered the match line.
    findNext: () => {
      findNext(view);
      scheduleReveal(view);
    },
    findPrevious: () => {
      findPrevious(view);
      scheduleReveal(view);
    },
    replaceNext: () => {
      replaceNext(view);
      scheduleReveal(view);
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
      scheduleReveal(view);
      focusPersistently();
    },
    // `selectOptions`, not `options`: the core's own construction options are
    // already in scope here.
    selectLines: (startLine, endLine, selectOptions) => {
      const lastLine = view.state.doc.lines;
      const from = Math.max(1, Math.min(startLine, lastLine));
      const to = Math.max(from, Math.min(endLine, lastLine));
      const fromInfo = view.state.doc.line(from);
      const toInfo = view.state.doc.line(to);
      const reveal = selectOptions?.reveal ?? true;
      view.dispatch({
        // Anchor at the end so the cursor sits after the span: extending or
        // typing behaves the way a drag-selection would.
        selection: { anchor: toInfo.to, head: fromInfo.from },
        // Centering is for arriving from somewhere else. Selecting the line you
        // are already looking at must not move the page under you, so that path
        // asks for no reveal at all — not even the nudge, which would still
        // shift a line sitting inside the viewport's top or bottom margin.
        ...(reveal ? { effects: EditorView.scrollIntoView(fromInfo.from, { y: "center" }) } : null),
      });
      if (reveal) {
        scheduleReveal(view);
      }
      // Focus regardless: CM6 focuses with preventScroll, so this never travels.
      focusPersistently();
    },
    selectAll: () => {
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
      focusPersistently();
    },
    // The clipboard half of cut/paste lives in the host (one clipboard API for
    // web and native); this is only the document edit, dispatched as a user
    // event so it joins the undo history like typed input.
    replaceSelection: (text) => {
      const { main } = view.state.selection;
      view.dispatch({
        changes: { from: main.from, to: main.to, insert: text },
        selection: { anchor: main.from + text.length },
        userEvent: "input.paste",
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
      if (revealFrame !== null) {
        cancelAnimationFrame(revealFrame);
        revealFrame = null;
      }
      view.scrollDOM.removeEventListener("scroll", handleScroll);
      view.destroy();
    },
  };
}
