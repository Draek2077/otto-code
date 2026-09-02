import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
// Aliased: `renderHoverContent` already takes a `markdown` parameter.
import { markdown as markdownSupport, markdownLanguage } from "@codemirror/lang-markdown";
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
import {
  Annotation,
  Compartment,
  EditorState,
  Prec,
  Text,
  type Extension,
} from "@codemirror/state";
import {
  type BlockInfo,
  closeHoverTooltips,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  hoverTooltip,
  lineNumbers,
  type TooltipView,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { getLanguageForFile, getParserForFile, highlightCode } from "@otto-code/highlight";
import { getCM, Vim, vim, type CodeMirror } from "@replit/codemirror-vim";
import {
  getMarkdownCommand,
  isMarkdownCommandName,
  markdownImageDropHandler,
  markdownPasteHandler,
} from "./markdown/markdown-commands";
import {
  markdownCompletionExtension,
  setMarkdownLinkTargetsEffect,
} from "./markdown/markdown-completion";
import {
  markdownLivePreviewExtension,
  setMarkdownLivePreview,
} from "./markdown/markdown-live-preview";
import { isMarkdownPath } from "./markdown/markdown-path";
import {
  DEFAULT_EDITOR_KEY_BINDINGS,
  type EditorCursorPosition,
  type EditorDiagnostic,
  type EditorDroppedImage,
  type EditorFindState,
  type EditorHoverAnswer,
  type EditorKeyAction,
  type EditorKeyBinding,
  type MarkdownCommandName,
  type EditorMatchInfo,
  type EditorPointerSelect,
  type EditorScrollMetrics,
  type EditorThemeSpec,
  type EditorVimMode,
} from "./editor-contract";
import {
  DEFAULT_VIM_MAPPING_SETTINGS,
  getVimMappingAction,
  isVimMappingPrefix,
  type VimMappingSettings,
} from "./vim-mappings";
import {
  createDiagnosticsExtension,
  diagnosticsAtPos,
  renderDiagnosticList,
  setEditorDiagnostics,
} from "./editor-diagnostics";
import { createOverviewRulerExtension } from "./editor-overview-ruler";
import {
  filenameForHoverLanguage,
  parseHoverMarkdown,
  plainProse,
  type HoverCodeSegment,
  type HoverProseSegment,
} from "./hover-markdown";
import { findWordAtCursor } from "./word-at-cursor";

// The CM6 assembly shared by the web host (direct DOM mount) and the native
// webview entry. This module is bundled into the webview HTML - keep it free
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
  /** Web/Electron-only in-app Vim emulation. Native does not pass this option. */
  vimKeybindings?: boolean;
  vimMappings?: VimMappingSettings;
  markdownLivePreview?: boolean;
  onDirtyChanged?: (dirty: boolean) => void;
  onMatchInfo?: (info: EditorMatchInfo | null) => void;
  onCursorMoved?: (position: EditorCursorPosition) => void;
  onVimModeChanged?: (mode: EditorVimMode | null) => void;
  onVimMappingPendingChanged?: (pending: boolean) => void;
  /**
   * An image was pasted or dropped into a markdown document. Omitting it
   * registers no handler, which is how a host without the daemon's
   * binary-write capability declines the feature - see
   * `markdownImageDropHandler`.
   */
  onImageDrop?: (images: readonly EditorDroppedImage[]) => void;
  /**
   * Which key runs which of the `on*Shortcut` callbacks. The app host feeds this
   * from the user's shortcut registry; omitting it falls back to
   * `DEFAULT_EDITOR_KEY_BINDINGS`, which is what the native webview does.
   */
  keyBindings?: readonly EditorKeyBinding[];
  onSaveShortcut?: () => void;
  onFindShortcut?: () => void;
  /**
   * Escape pressed with find active. Only fires while a query is running, so
   * Escape keeps its editing meaning (collapse multiple selections) the rest of
   * the time.
   */
  onCloseFindShortcut?: () => void;
  onGoToLineShortcut?: () => void;
  onGoToDefinitionShortcut?: () => void;
  onFindReferencesShortcut?: () => void;
  onRenameSymbolShortcut?: () => void;
  onVimAction?: (action: import("./vim-mappings").VimMappingAction) => void;
  /** Fires on every doc change without content; callers pull getDoc as needed. */
  onDocChanged?: () => void;
  // Split-view scroll sync; both fire only for user-initiated interactions
  // (programmatic scrolls through the core are suppressed at the source).
  onScrolled?: (metrics: EditorScrollMetrics) => void;
  onPointerSelect?: (select: EditorPointerSelect) => void;
  /**
   * A right-click landed in the editor, reported in viewport coordinates so the
   * host can anchor its own menu. Supplying this SUPPRESSES the platform menu -
   * the host is then responsible for offering the edit actions (see
   * file-tab-pane's editor context menu).
   */
  onContextMenu?: (point: { x: number; y: number }) => void;
  /**
   * Resolve the language server's explanation for a 1-based position. Absent means no
   * hover at all - which is the correct state on touch platforms, where there is no
   * pointer to rest and CM6's hover events never fire.
   */
  hoverProvider?: (position: { line: number; column: number }) => Promise<EditorHoverAnswer>;
  /** Problems to mark at mount, before the first push arrives. */
  diagnostics?: readonly EditorDiagnostic[];
  /**
   * Hide the platform's own scrollbar on the editor's scroller. Set by hosts
   * that draw the app's auto-hiding overlay bar instead (web/desktop). It is a
   * THEME rule rather than something the overlay hook switches on after mount:
   * an imperative hide only lands on the second frame, so remounting the editor
   * - which is what switching to split or preview does - flashed the platform
   * bar for a frame first. Off by default so the native webview keeps the
   * touch scroll indicator it has no overlay to replace.
   */
  hideNativeScrollbar?: boolean;
}

export interface EditorCoreSelection {
  text: string;
  lineStart: number;
  lineEnd: number;
  /** 1-based, UTF-16 code units - see `EditorSelection`, which this satisfies. */
  columnStart: number;
  columnEnd: number;
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
  /** Toggle in-app Vim without remounting the CM6 editor. */
  setVimKeybindings(enabled: boolean): void;
  /** Replace the validated leader mappings without remounting the editor. */
  setVimMappings(settings: VimMappingSettings): void;
  /** Re-key the editor commands, so a rebind in Settings lands without a remount. */
  setKeyBindings(bindings: readonly EditorKeyBinding[]): void;
  /**
   * Run a markdown formatting command, the toolbar's entry point. Returns false
   * when the command declined - outside markdown, or with nothing to change -
   * so a button can stay honest about having done nothing.
   */
  runMarkdownCommand(name: MarkdownCommandName): boolean;
  /** Hide markdown markers except on the line being edited. */
  setMarkdownLivePreview(enabled: boolean): void;
  /**
   * Replace the workspace file list markdown link completion offers. A snapshot,
   * not a delta, for the same reason `setDiagnostics` is.
   */
  setMarkdownLinkTargets(paths: readonly string[]): void;
  /** Replace the whole problem set; see the contract's note on why it is never a delta. */
  setDiagnostics(diagnostics: readonly EditorDiagnostic[]): void;
  destroy(): void;
}

function normalizeVimMode(mode: string | undefined): EditorVimMode {
  switch (mode) {
    case "insert":
      return "INSERT";
    case "visual":
      return "VISUAL";
    case "replace":
      return "REPLACE";
    default:
      return "NORMAL";
  }
}

// Counting stops here so a pathological query on a huge file cannot stall the
// UI; the strip renders "999+" beyond it.
const MAX_COUNTED_MATCHES = 999;

// ~4 frames (≈64ms): long enough to outlast a mount that steals focus back,
// short enough that a user cannot have deliberately clicked elsewhere yet.
const FOCUS_RETRY_FRAMES = 4;

const setDocAnnotation = Annotation.define<boolean>();

// Hover-tooltip scrollbar, derived from the app's own desktop scrollbar
// (web-desktop-scrollbar.tsx: 6px idle, 9px active, 220ms fade). The track is wider
// than the thumb because the difference is drawn as a transparent border - that inset
// is what makes it read as an overlay bar. Restated here rather than imported: this
// module is bundled into the native webview and must not reach into app components.
const HOVER_SCROLLBAR_IDLE_PX = 6;
const HOVER_SCROLLBAR_ACTIVE_PX = 9;
const HOVER_SCROLLBAR_TRACK_PX = 12;
const HOVER_SCROLLBAR_FADE_MS = 220;
const HOVER_SCROLLBAR_INSET_PX = (HOVER_SCROLLBAR_TRACK_PX - HOVER_SCROLLBAR_IDLE_PX) / 2;
const HOVER_SCROLLBAR_ACTIVE_INSET_PX = (HOVER_SCROLLBAR_TRACK_PX - HOVER_SCROLLBAR_ACTIVE_PX) / 2;

// How long the hover source waits for a real answer before falling back to a tooltip
// that fills itself in. Deliberately short: it is pure added latency on the cold path,
// and its only job is to keep a warm server - which answers well inside it - from ever
// rendering the pending state. It is NOT the pointer-rest delay; CM6's `hoverTime`
// still owns that and is untouched.
const HOVER_GRACE_MS = 120;
// Re-ask cadence while a server reports itself still indexing.
const HOVER_RETRY_MS = 400;
/**
 * Stop re-asking eventually, but measure patience against the server's own signal rather than a
 * stopwatch. `warming` means the daemon can see work-done progress in flight, so the server is
 * loading, not wedged - and how long that takes is a property of the project, not of us. A .NET
 * solution of a few hundred projects takes tens of seconds to load; the old 15s ceiling was
 * shorter than the daemon's own 20s request budget, so the first reply always arrived after the
 * ceiling had passed and the tooltip closed having never retried once.
 *
 * This cap only catches a server that reports indexing forever, which is a bug in that server.
 */
const HOVER_RETRY_CEILING_MS = 5 * 60_000;
const HOVER_SPINNER_PX = 11;

// The glyph column, between the line numbers and the code.
//
// Its width is the whole cost of putting it on that side: every pixel is one the line
// numbers are pushed away from the text they number. So it is sized to the dot plus the
// smallest gap that still reads as a gap - not to a comfortable margin. A marker channel,
// not a toolbar.
const DIAGNOSTIC_GUTTER_PX = 11;
const DIAGNOSTIC_DOT_PX = 6;

// The overview ruler splits into two bands: problem marks on the left, search
// hits on the right. Two bands rather than one shared one, because overlapping
// them would let a hit hide an error - and not hiding errors is the lane's job.
const PROBLEM_LANE_WIDTH = "62%";
const MATCH_LANE_WIDTH = "calc(38% - 2px)";

/**
 * One severity's underline, complete. Kept as a function so a severity can never end up
 * carrying the line style without the colour - see the note at the call site.
 */
function diagnosticUnderline(color: string, style: "wavy" | "dotted"): Record<string, string> {
  return {
    textDecorationLine: "underline",
    textDecorationStyle: style,
    textDecorationColor: color,
    textDecorationSkipInk: "none",
    textUnderlineOffset: "3px",
    // Thinner than the browser default, which at this font size looks like a
    // strikethrough on a narrow glyph.
    textDecorationThickness: style === "wavy" ? "1px" : "2px",
  };
}
const HOVER_SPINNER_SPIN_MS = 700;

// `.cm-line`'s left padding, restated below as a hard requirement because the
// ruler stripe is positioned from the line box's origin and has to land on the
// same x as the first character.
const LINE_PADDING_LEFT_PX = 6;

// The line-length ruler is a 1px background stripe rather than a decoration or
// an overlay element: no extra DOM, no per-line cost, and it paints behind the
// text for free. `ch` is the advance width of "0" - exact for a mono stack, and
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

// Column is 1-based and counted in UTF-16 code units - the same unit CM6 uses
// for offsets, so it always agrees with what the editor itself considers a
// position. (An astral emoji therefore advances the column by 2; matching CM6
// beats matching an abstract notion of "character" the editor doesn't share.)
/**
 * The overview ruler's own CSS. Lives here with the rest of the editor's styling
 * because the lane's colours come from the spec, and the extension that draws it
 * must stay free of anything that cannot cross into the native webview.
 *
 * The lane is RESERVED, not overlaid: `.cm-scroller` carries a matching
 * padding-right (below), so wrapped text wraps before the lane rather than
 * disappearing under it.
 */
function overviewRulerRules(spec: EditorThemeSpec): Record<string, Record<string, string>> {
  if (spec.overviewRulerWidth <= 0) {
    return {};
  }
  return {
    ".cm-otto-overview": {
      position: "absolute",
      top: "0",
      right: "0",
      bottom: "0",
      width: `${spec.overviewRulerWidth}px`,
      backgroundColor: spec.overviewRulerBackground,
      borderLeft: `1px solid ${spec.overviewRulerBorder}`,
      // Above the content, below CM6's tooltips (z-index 100 in its base theme).
      zIndex: "5",
      cursor: "pointer",
      // Without this the drag gesture is claimed by the webview's own scrolling
      // on touch, and the lane can be tapped but never scrubbed.
      touchAction: "none",
      userSelect: "none",
      WebkitUserSelect: "none",
    },
    ".cm-otto-overview-marks": {
      position: "absolute",
      inset: "0",
      // The marks are painted, not pressed: every pointer event belongs to the
      // track, which turns any position into a scroll.
      pointerEvents: "none",
    },
    ".cm-otto-overview-mark": {
      position: "absolute",
      top: "0",
      borderRadius: "1px",
    },
    ".cm-otto-overview-mark-problem": { left: "1px", width: PROBLEM_LANE_WIDTH },
    ".cm-otto-overview-mark-error": { backgroundColor: spec.diagnostic.error },
    ".cm-otto-overview-mark-warning": { backgroundColor: spec.diagnostic.warning },
    ".cm-otto-overview-mark-info": { backgroundColor: spec.diagnostic.info },
    ".cm-otto-overview-mark-hint": { backgroundColor: spec.diagnostic.hint },
    ".cm-otto-overview-mark-match": {
      right: "1px",
      width: MATCH_LANE_WIDTH,
      backgroundColor: spec.overviewRulerMatch,
    },
    // The hit find is currently on: the whole lane, not the right band, so
    // stepping through results moves something you can follow without hunting.
    // Same amber - see the note on `active` in editor-overview-ruler.ts for why
    // this is size rather than a second colour.
    ".cm-otto-overview-mark-match-active": {
      left: "1px",
      right: "1px",
      width: "auto",
    },
    // Selected ranges, behind everything else in the lane.
    ".cm-otto-overview-selections": {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
    },
    ".cm-otto-overview-band": {
      position: "absolute",
      top: "0",
      left: "0",
      right: "0",
      backgroundColor: spec.overviewRulerSelection,
    },
    // Full width and thinner than a mark: the caret is a position, not a range,
    // and spanning the lane is what distinguishes it from the things it sits among.
    ".cm-otto-overview-cursor": {
      position: "absolute",
      top: "0",
      left: "0",
      right: "0",
      height: "2px",
      backgroundColor: spec.overviewRulerCursor,
      pointerEvents: "none",
    },
    ".cm-otto-overview-thumb": {
      position: "absolute",
      top: "0",
      left: "0",
      right: "0",
      backgroundColor: spec.overviewRulerThumb,
      pointerEvents: "none",
    },
    // The lane IS the vertical scrollbar, so the platform's must not draw a
    // second one inside it. Axis-scoped, because the horizontal indicator is
    // still the only thing telling a touch user a line runs off the right.
    // Web hosts hide both through `hideNativeScrollbar` instead.
    ".cm-scroller::-webkit-scrollbar:vertical": {
      display: "none",
      width: "0",
    },
  };
}

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
      // Reserves the overview ruler's lane (0px when it is off). Padding on the
      // scroller rather than a margin on the editor: it narrows the content box,
      // which is what `lineWrapping` measures, so a wrapped line breaks at the
      // lane's edge instead of running under it.
      paddingRight: `${Math.max(0, spec.overviewRulerWidth)}px`,
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
    // The stripe is the line box itself - a plain background on `.cm-line`, the
    // way CM6 ships it. That is what keeps it exactly the height of the row and
    // exactly in step with the gutter: it IS the row, rather than a rectangle
    // computed to match one.
    //
    // The catch is that `drawSelection` renders into `.cm-selectionLayer` at a
    // NEGATIVE z-index - behind the content - so an OPAQUE line background hides
    // the selection on the caret's line completely. `activeLineBackground` is
    // therefore translucent (see editor-theme.ts), which is exactly why CM6's own
    // default is `#cceeff44`. Keep it translucent: an opaque value here silently
    // eats the selection, and moving the stripe into its own layer to dodge that
    // is what broke the alignment (both were tried; see docs/text-editor.md).
    //
    // The ruler needs no redraw here for the same reason - the gradient on
    // `.cm-content` shows through.
    ".cm-activeLine": {
      backgroundColor: spec.activeLineBackground,
    },
    ".cm-gutters": {
      backgroundColor: spec.gutterBackground,
      color: spec.gutterForeground,
      // CM6's base theme leaves grow at its browser default. That is normally
      // zero, but a host-level flex rule can turn the gutter into the pane's
      // growing child and leave the code well with no width. The gutter has
      // intrinsic content (line numbers + the 11px diagnostic lane), so state
      // the only valid sizing contract here instead of relying on that default.
      flex: "0 0 auto",
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
    // color. The active hit is deliberately a big step up, not a nudge - this
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
    // Hover explanations. Themed here rather than in the app's stylesheet because
    // CM6 mounts tooltips in its own DOM, which on native lives inside the webview
    // where the app's styles do not reach.
    ".cm-tooltip": {
      backgroundColor: spec.tooltipBackground,
      color: spec.foreground,
      border: `1px solid ${spec.tooltipBorder}`,
      borderRadius: "6px",
      // The app's `md` elevation, composed into CSS by buildEditorThemeSpec: the
      // shadow tokens are React Native objects (shadowColor/Offset/Radius) which
      // do not cross into CSS, and this module cannot import them anyway.
      boxShadow: spec.tooltipShadow,
    },
    ".cm-otto-hover": {
      maxWidth: "560px",
      maxHeight: "280px",
      overflow: "auto",
      // Reserve the track so revealing the thumb never reflows the text.
      scrollbarGutter: "stable",
      // Firefox has no pseudo-elements to style: `thin` plus a transparent thumb
      // is the whole auto-hide there, revealed by the `:hover` rule below.
      scrollbarWidth: "thin",
      scrollbarColor: "transparent transparent",
    },
    ".cm-otto-hover:hover": {
      scrollbarColor: `${spec.scrollbarHandle} transparent`,
    },
    // Chromium/WebKit. The thumb is drawn inside a transparent border with
    // `background-clip: content-box`, which is what makes a native scrollbar read
    // as a slim overlay bar rather than a chrome gutter - matching the app's own
    // desktop scrollbar (6px idle, 9px active, fully rounded).
    ".cm-otto-hover::-webkit-scrollbar": {
      width: `${HOVER_SCROLLBAR_TRACK_PX}px`,
      height: `${HOVER_SCROLLBAR_TRACK_PX}px`,
    },
    ".cm-otto-hover::-webkit-scrollbar-track": {
      backgroundColor: "transparent",
    },
    ".cm-otto-hover::-webkit-scrollbar-thumb": {
      backgroundColor: "transparent",
      borderRadius: "999px",
      border: `${HOVER_SCROLLBAR_INSET_PX}px solid transparent`,
      backgroundClip: "content-box",
      // Only the colour transitions: animating width would make the thumb wobble
      // as the pointer crosses it.
      transition: `background-color ${HOVER_SCROLLBAR_FADE_MS}ms`,
    },
    // Auto-hide means "visible while the pointer is on the tooltip". For a hover
    // tooltip that is the whole of it - the surface only exists while pointed at,
    // so there is no idle state to time out of the way the app's scroll views have.
    ".cm-otto-hover:hover::-webkit-scrollbar-thumb": {
      backgroundColor: spec.scrollbarHandle,
    },
    ".cm-otto-hover::-webkit-scrollbar-thumb:hover": {
      backgroundColor: spec.scrollbarHandle,
      borderWidth: `${HOVER_SCROLLBAR_ACTIVE_INSET_PX}px`,
    },
    ".cm-otto-hover::-webkit-scrollbar-corner": {
      backgroundColor: "transparent",
    },
    // The signature. Keeps the code font - it IS code - but NOT a background of its
    // own: the tooltip is a single floating card on `tooltipBackground`, and painting
    // the deepened code well (`spec.background`) in here punched a near-black slab out
    // of that card on every dark theme. One surface per card; the mono font and the
    // divider below are what separate the signature from the prose. `pre` already
    // preserves its own whitespace.
    ".cm-otto-hover-code": {
      margin: "0",
      padding: "8px 10px",
      backgroundColor: "transparent",
      color: spec.foreground,
      fontFamily: spec.fontFamily,
      fontSize: `${spec.fontSize}px`,
      lineHeight: "1.5",
      // Wrap rather than scroll horizontally: a long generic signature is the common
      // case, and a hover you have to scroll sideways to read is unreadable.
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
    },
    // Documentation. Proportional and muted, so prose stops competing with the
    // signature above it - this is the difference between a blob and a card.
    ".cm-otto-hover-prose": {
      padding: "8px 10px",
      color: spec.gutterForeground,
      fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
      fontSize: `${Math.max(11, spec.fontSize - 1)}px`,
      lineHeight: "1.5",
      whiteSpace: "pre-wrap",
    },
    ".cm-otto-hover-divider": {
      height: "1px",
      backgroundColor: spec.tooltipBorder,
    },
    // The waiting state, shown only when the server missed the grace period. Padded to
    // roughly one line of signature so the swap to real content is a fill rather than a
    // jump, and muted like the prose because it is chrome, not an answer.
    ".cm-otto-hover-pending": {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "8px 10px",
      color: spec.gutterForeground,
      fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
      lineHeight: "1.5",
    },
    ".cm-otto-hover-spinner": {
      display: "inline-block",
      flex: "0 0 auto",
      width: `${HOVER_SPINNER_PX}px`,
      height: `${HOVER_SPINNER_PX}px`,
      borderRadius: "999px",
      // One lit arc on a dim ring: the same read as the app's own spinners, expressible
      // in plain CSS, which is all this module can use inside the webview.
      border: `1.5px solid ${spec.tooltipBorder}`,
      borderTopColor: spec.gutterForeground,
      animation: `cm-otto-hover-spin ${HOVER_SPINNER_SPIN_MS}ms linear infinite`,
    },
    "@keyframes cm-otto-hover-spin": {
      to: { transform: "rotate(360deg)" },
    },
    // Problem markers. A wavy underline rather than a background wash: the wash would
    // fight the active-line stripe and the selection, both of which are already
    // translucent fills on the same text, and three overlapping washes read as mud.
    // `skip-ink: none` keeps the wave continuous through descenders.
    // Each severity carries the WHOLE decoration, including its colour. Split across a
    // shared base rule plus a colour-only override, the colour silently lost and every
    // squiggle fell back to `currentColor` - the editor foreground - which reads as "this
    // is fine" on the one thing that is not. One rule per severity cannot do that.
    ".cm-otto-diagnostic-error": diagnosticUnderline(spec.diagnostic.error, "wavy"),
    ".cm-otto-diagnostic-warning": diagnosticUnderline(spec.diagnostic.warning, "wavy"),
    ".cm-otto-diagnostic-info": diagnosticUnderline(spec.diagnostic.info, "wavy"),
    // Dotted, not wavy. A hint is the server being helpful - tsserver emits them by the
    // dozen on plain JavaScript - and a wavy underline is the visual language of "this is
    // broken". Giving hints their own line style means severity is legible before you
    // read a single colour.
    ".cm-otto-diagnostic-hint": diagnosticUnderline(spec.diagnostic.hint, "dotted"),
    // The glyph column, between the line numbers and the code. Its width is held by an
    // invisible spacer so the code does not shift sideways the first time an error lands.
    //
    // NOTHING here may touch layout. CM6 sets `.cm-gutter { display:flex !important;
    // flex-direction:column }` and positions the lines it skipped with `marginTop` - a
    // `justify-content` of ours centred the whole stack along that vertical main axis and
    // parked every marker hundreds of pixels from its line. Centering belongs on the
    // per-line element below, which has a real height to centre within.
    ".cm-otto-diagnostic-gutter": {
      minWidth: `${DIAGNOSTIC_GUTTER_PX}px`,
      cursor: "default",
    },
    ".cm-otto-diagnostic-gutter .cm-gutterElement": {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    },
    ".cm-otto-diagnostic-dot": {
      flex: "0 0 auto",
      width: `${DIAGNOSTIC_DOT_PX}px`,
      height: `${DIAGNOSTIC_DOT_PX}px`,
      borderRadius: "999px",
      // The spacer shares this class and gets no colour, so it occupies the width
      // without drawing anything.
      backgroundColor: "transparent",
    },
    ".cm-otto-diagnostic-dot-error": { backgroundColor: spec.diagnostic.error },
    ".cm-otto-diagnostic-dot-warning": { backgroundColor: spec.diagnostic.warning },
    ".cm-otto-diagnostic-dot-info": { backgroundColor: spec.diagnostic.info },
    ".cm-otto-diagnostic-dot-hint": { backgroundColor: spec.diagnostic.hint },
    // The explanation card. Proportional, because a compiler message is prose - the
    // same call as the hover documentation, and for the same reason.
    ".cm-otto-diagnostic-card": {
      fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
    },
    ".cm-otto-diagnostic-entry": {
      padding: "8px 10px",
      display: "flex",
      flexDirection: "column",
      gap: "4px",
    },
    ".cm-otto-diagnostic-headline": {
      display: "flex",
      alignItems: "flex-start",
      gap: "7px",
      color: spec.foreground,
      fontSize: `${Math.max(11, spec.fontSize - 1)}px`,
      lineHeight: "1.45",
    },
    // A severity dot on the message, so which kind of problem this is survives being
    // read out of the gutter's context.
    ".cm-otto-diagnostic-badge": {
      flex: "0 0 auto",
      width: `${DIAGNOSTIC_DOT_PX}px`,
      height: `${DIAGNOSTIC_DOT_PX}px`,
      borderRadius: "999px",
      // Nudged down to sit on the first line's optical centre rather than its top.
      marginTop: "5px",
    },
    // The server's suggested fix, indented under the message it belongs to.
    ".cm-otto-diagnostic-help": {
      paddingLeft: `${DIAGNOSTIC_DOT_PX + 7}px`,
      color: spec.gutterForeground,
      fontSize: `${Math.max(10, spec.fontSize - 2)}px`,
      lineHeight: "1.45",
    },
    // Which tool and which rule. Monospace and quiet: it is an identifier, not prose.
    ".cm-otto-diagnostic-source": {
      display: "block",
      paddingLeft: `${DIAGNOSTIC_DOT_PX + 7}px`,
      color: spec.gutterForeground,
      fontFamily: spec.fontFamily,
      fontSize: `${Math.max(10, spec.fontSize - 3)}px`,
      textDecoration: "none",
    },
    ".cm-otto-diagnostic-link": {
      cursor: "pointer",
      textDecoration: "underline",
      textDecorationStyle: "dotted",
    },
    ".cm-otto-diagnostic-link:hover": {
      color: spec.foreground,
    },
    ...overviewRulerRules(spec),
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
    // Markdown prose. Colour alone cannot carry emphasis in a document whose
    // whole point is emphasis, so these are the one place the highlighter sets
    // weight and decoration rather than just a hue. Headings additionally step
    // up in size, which is what makes a document's shape legible in the source
    // view without any live-preview rendering.
    { tag: tags.strong, fontWeight: "bold" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strikethrough, textDecoration: "line-through" },
    { tag: tags.monospace, color: s.string },
    { tag: tags.heading1, color: s.heading, fontWeight: "bold", fontSize: "1.5em" },
    { tag: tags.heading2, color: s.heading, fontWeight: "bold", fontSize: "1.3em" },
    { tag: tags.heading3, color: s.heading, fontWeight: "bold", fontSize: "1.15em" },
    { tag: tags.heading4, color: s.heading, fontWeight: "bold" },
    { tag: tags.heading5, color: s.heading, fontWeight: "bold" },
    { tag: tags.heading6, color: s.heading, fontWeight: "bold" },
    // The markers themselves recede: they are syntax, not content, and at full
    // strength they compete with the text they are marking up.
    { tag: tags.processingInstruction, color: s.punctuation },
    { tag: tags.contentSeparator, color: s.punctuation },
    { tag: tags.quote, color: s.comment, fontStyle: "italic" },
    { tag: tags.list, color: s.punctuation },
    { tag: tags.url, color: s.link, textDecoration: "underline" },
  ]);
  return syntaxHighlighting(style, { fallback: true });
}

/**
 * Resolve a fence's info string to a grammar, so a ```ts block inside a
 * markdown file colours with the same parser a `.ts` tab uses.
 *
 * The info may be a language name (`typescript`) or an extension (`ts`), and
 * both spellings are common in the wild. `filenameForHoverLanguage` already
 * owns the name → extension table for hover code blocks; reusing it is what
 * keeps this from becoming a second, drifting copy of that map. Anything it
 * doesn't name is tried as a bare extension, which covers every grammar the
 * parser registry knows under its own suffix.
 */
function markdownFenceLanguage(info: string): Language | null {
  // A fence may carry attributes: ```ts title="x".
  const tag = info.trim().split(/\s+/, 1)[0]?.toLowerCase();
  if (!tag) {
    return null;
  }
  const named = filenameForHoverLanguage(tag);
  if (named !== null) {
    const language = getLanguageForFile(named);
    if (language) {
      return language;
    }
  }
  return getLanguageForFile(`fence.${tag}`);
}

function buildLanguageExtension(path: string): Extension {
  // Markdown is the one format the editor *edits* rather than merely colours,
  // so it takes the full LanguageSupport instead of a bare parser: that is what
  // carries list continuation (Enter), markup-aware Backspace, GFM tables and
  // task lists, and paste-a-URL-over-a-selection-to-make-a-link. The keymap
  // rides at Prec.high but each of its commands returns false outside markdown
  // context, so it never shadows the default keymap in a code fence.
  if (isMarkdownPath(path)) {
    return [
      markdownSupport({
        // The GFM dialect, not strict CommonMark: tables, task lists and
        // strikethrough are what people actually write.
        base: markdownLanguage,
        codeLanguages: markdownFenceLanguage,
        // Worth its weight now that link completion mounts an `autocompletion()`
        // for markdown: the tag source has somewhere to run, and raw HTML in a
        // markdown file is common enough to be worth completing.
        completeHTMLTags: true,
      }),
      // Link targets and heading anchors. Mounted here rather than in the shared
      // extension list so the completion keymap cannot reach a code buffer.
      markdownCompletionExtension(path),
    ];
  }
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
// over the gutter text - and `preventDefault` keeps that drag from starting at
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

/**
 * The rebindable half of the editor's keymap, built from whatever bindings the
 * host handed us. Everything else CM6 binds - `defaultKeymap`, `historyKeymap`,
 * `indentWithTab`, Escape-closes-find - is mounted separately and untouched by a
 * rebind, so a user who never opens the shortcuts screen still gets a complete
 * editor.
 *
 * A binding whose callback is absent returns false rather than swallowing the
 * key: an unwired command must fall through to `defaultKeymap` (and then to the
 * platform) instead of becoming a key that does nothing.
 */
function buildShortcutKeymap(
  options: EditorCoreOptions,
  bindings: readonly EditorKeyBinding[],
): Extension {
  const handlers: Partial<Record<EditorKeyAction, (() => void) | undefined>> = {
    save: options.onSaveShortcut,
    find: options.onFindShortcut,
    goToLine: options.onGoToLineShortcut,
    goToDefinition: options.onGoToDefinitionShortcut,
    findReferences: options.onFindReferencesShortcut,
    renameSymbol: options.onRenameSymbolShortcut,
  };
  return keymap.of(
    bindings.map((binding) => ({
      key: binding.key,
      run: (view) => {
        // Markdown formatting is the editor's own work, not the host's: it edits
        // this document and never leaves. It also DECLINES outside markdown, and
        // returning false here is what hands the key to the next binding for the
        // same combo - which is how one keymap serves `Mod-b` as bold in a `.md`
        // file and as Go to definition in a `.ts` one.
        if (isMarkdownCommandName(binding.action)) {
          return getMarkdownCommand(binding.action)(view);
        }
        const handler = handlers[binding.action];
        if (!handler) {
          return false;
        }
        handler();
        return true;
      },
    })),
  );
}

function matchesEditorKey(event: KeyboardEvent, keyName: string): boolean {
  const parts = keyName.split("-");
  const key = parts.pop();
  if (!key) {
    return false;
  }
  const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
  const wantsMod = parts.includes("Mod");
  const wantsCtrl = parts.includes("Ctrl") || (wantsMod && !isMac);
  const wantsMeta = parts.includes("Meta") || (wantsMod && isMac);
  if (
    event.ctrlKey !== wantsCtrl ||
    event.metaKey !== wantsMeta ||
    event.altKey !== parts.includes("Alt") ||
    event.shiftKey !== parts.includes("Shift")
  ) {
    return false;
  }
  return event.key.length === 1 && key.length === 1
    ? event.key.toLowerCase() === key.toLowerCase()
    : event.key === key;
}

/** Keep Otto's editor callbacks ahead of Vim's own keydown handler locally. */
function buildVimOttoShortcutHandlers(
  options: EditorCoreOptions,
  bindings: readonly EditorKeyBinding[],
  isFindActive: () => boolean,
): Extension {
  const handlers: Partial<Record<EditorKeyAction, (() => void) | undefined>> = {
    save: options.onSaveShortcut,
    find: options.onFindShortcut,
    goToLine: options.onGoToLineShortcut,
    goToDefinition: options.onGoToDefinitionShortcut,
    findReferences: options.onFindReferencesShortcut,
    renameSymbol: options.onRenameSymbolShortcut,
  };
  return Prec.highest(
    EditorView.domEventHandlers({
      keydown: (event, view) => {
        if (event.key === "Escape" && isFindActive()) {
          options.onCloseFindShortcut?.();
          event.preventDefault();
          return true;
        }
        for (const binding of bindings) {
          if (!matchesEditorKey(event, binding.key)) {
            continue;
          }
          if (isMarkdownCommandName(binding.action)) {
            if (!isMarkdownPath(options.path)) {
              continue;
            }
            if (!getMarkdownCommand(binding.action)(view)) {
              continue;
            }
            event.preventDefault();
            return true;
          }
          const handler = handlers[binding.action];
          if (!handler) {
            return false;
          }
          handler();
          event.preventDefault();
          return true;
        }
        return false;
      },
    }),
  );
}

/**
 * Local leader mappings. The CM6 Vim package has a process-global mapping API,
 * so using it here would make one file tab's settings leak into every tab.
 * Capture only plain normal-mode keys on this editor's DOM instead; the host
 * callback then routes into the existing action/focus infrastructure.
 */
interface VimMappingExtension {
  extension: Extension;
  dispose: () => void;
}

function isUnmodifiedEscape(event: KeyboardEvent): boolean {
  return event.key === "Escape" && !event.ctrlKey && !event.metaKey && !event.altKey;
}

function isPlainVimMappingKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }
  return event.key === " " || (/^[A-Za-z0-9]$/.test(event.key) && !event.shiftKey);
}

function isVimMappingNormalMode(cm: CodeMirror | null | undefined): cm is CodeMirror {
  const vimState = cm?.state.vim;
  return Boolean(cm && vimState && !vimState.insertMode && !vimState.visualMode);
}

function buildVimMappings(
  settings: VimMappingSettings,
  onAction: ((action: import("./vim-mappings").VimMappingAction) => void) | undefined,
  onPendingChanged: ((pending: boolean) => void) | undefined,
): VimMappingExtension {
  if (!onAction || Object.keys(settings.mappings).length === 0) {
    return { extension: [], dispose: () => undefined };
  }
  let pendingSequence: string | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const clearPending = (): void => {
    if (pendingSequence !== null) {
      onPendingChanged?.(false);
    }
    pendingSequence = null;
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
  };
  const replayPendingSequence = (cm: CodeMirror, sequence: string): void => {
    Vim.handleKey(cm, " ", "otto-vim-leader");
    for (const key of sequence) {
      Vim.handleKey(cm, key, "otto-vim-leader");
    }
  };
  const armTimeout = (cm: CodeMirror): void => {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      timeout = null;
      if (pendingSequence !== null) {
        const sequence = pendingSequence;
        pendingSequence = null;
        onPendingChanged?.(false);
        replayPendingSequence(cm, sequence);
      }
    }, 650);
  };

  return {
    extension: Prec.highest(
      EditorView.domEventHandlers({
        keydown: (event, view) => {
          const cm = getCM(view);
          if (!isVimMappingNormalMode(cm)) {
            clearPending();
            return false;
          }
          if (pendingSequence !== null && isUnmodifiedEscape(event)) {
            clearPending();
            event.preventDefault();
            return true;
          }
          if (!isPlainVimMappingKey(event)) {
            if (pendingSequence !== null) {
              const sequence = pendingSequence;
              clearPending();
              replayPendingSequence(cm, sequence);
            }
            return false;
          }
          if (pendingSequence === null) {
            if (event.key !== " " || !isVimMappingPrefix(settings, "")) {
              return false;
            }
            pendingSequence = "";
            onPendingChanged?.(true);
            armTimeout(cm);
            event.preventDefault();
            return true;
          }

          const sequence = `${pendingSequence}${event.key}`;
          const action = getVimMappingAction(settings, sequence);
          if (action) {
            clearPending();
            onAction(action);
            event.preventDefault();
            return true;
          }
          if (isVimMappingPrefix(settings, sequence)) {
            pendingSequence = sequence;
            armTimeout(cm);
            event.preventDefault();
            return true;
          }
          const prefix = pendingSequence;
          clearPending();
          replayPendingSequence(cm, prefix);
          return false;
        },
      }),
    ),
    dispose: clearPending,
  };
}

export function createEditorCore(options: EditorCoreOptions): EditorCore {
  const themeCompartment = new Compartment();
  const wrapCompartment = new Compartment();
  const vimCompartment = new Compartment();
  const vimShortcutCompartment = new Compartment();
  const vimMappingCompartment = new Compartment();
  const keymapCompartment = new Compartment();
  // The hover tooltip builds its own DOM with inline syntax colours, so it needs the
  // spec at render time rather than at mount: a theme switch reconfigures the
  // compartment, and a tooltip opened afterwards must use the new colours.
  let activeTheme = options.theme;
  let findActive = false;
  let vimKeybindings = Boolean(options.vimKeybindings);
  let vimMappings = options.vimMappings ?? DEFAULT_VIM_MAPPING_SETTINGS;
  let vimMappingExtension = buildVimMappings(
    vimMappings,
    vimKeybindings ? options.onVimAction : undefined,
    options.onVimMappingPendingChanged,
  );

  // Dirty is a COMPARISON against the saved text, not a latch on "an edit
  // happened". Any edit that leaves the document equal to that text is not a
  // modification, however it got there - undo, redo, a cut whose paste puts it
  // back, retyping the character you just deleted. Latching on the first
  // docChanged left Save and Revert armed against a file that no longer
  // differed from disk.
  //
  // `cleanDoc` is a Text, not a string, because `Text.eq` is the cheap
  // primitive for a per-keystroke check: it rejects on length or line count
  // first (O(1) for ordinary typing) and then prunes the subtrees CM6's rope
  // shares between two near-identical documents, so a full character walk is
  // reached only for an equal-length edit - exactly the case that might be a
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
  // pass lands the scroller at the wrong offset - measured at ~175px (≈10 lines)
  // past a search match, with no scrollable ancestor involved, so it is CM6's
  // height-map estimate for the jump, not a feedback loop. It also does not
  // self-correct, so the target sits just out of view. This bit both typing at
  // an off-screen caret and stepping through search matches.
  //
  // `coordsAtPos` returns the target's real DOM rectangle (ground truth,
  // independent of the height map) once the line is rendered - which it is after
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
      // Vim must be mounted before the remaining keymaps so it owns modal
      // editing keys. Its unrecognised keys fall through to Otto's existing
      // shortcut keymap and then CodeMirror's ordinary bindings.
      vimCompartment.of(options.vimKeybindings ? vim() : []),
      vimShortcutCompartment.of(
        options.vimKeybindings
          ? buildVimOttoShortcutHandlers(
              options,
              options.keyBindings ?? DEFAULT_EDITOR_KEY_BINDINGS,
              () => findActive,
            )
          : [],
      ),
      vimMappingCompartment.of(vimMappingExtension.extension),
      // Otto's own editor commands, keyed by the user's shortcut registry.
      // Highest precedence is intentional: Vim's default Ctrl-f page motion
      // must not take the existing File Editor Find binding away.
      keymapCompartment.of(
        Prec.highest(
          buildShortcutKeymap(options, options.keyBindings ?? DEFAULT_EDITOR_KEY_BINDINGS),
        ),
      ),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      // Escape belongs to find while find is running: dismissing the strip
      // (and with it every match highlight) has to work from the file
      // contents, not only from the find box, even when Vim is enabled.
      // Returning false while find is idle leaves Escape to Vim's mode change.
      Prec.highest(
        keymap.of([
          {
            key: "Escape",
            run: () => {
              if (!findActive) {
                return false;
              }
              options.onCloseFindShortcut?.();
              return true;
            },
          },
        ]),
      ),
      // Right-click is a "act on what I am pointing at" gesture, so the caret
      // moves to the click before the menu opens - unless the click landed
      // inside an existing selection, which the user is pointing at on purpose.
      // Without this, "Go to Definition" would run on wherever the caret
      // happened to be, not on the word under the pointer.
      ...(options.hoverProvider
        ? [buildHoverTooltip(options.hoverProvider, () => activeTheme, options.path)]
        : []),
      // ORDER IS THE LAYOUT for gutters: CM6 renders them left to right in extension
      // order, so this mounting AFTER `lineNumbers()` is what puts the glyph column on
      // the numbers' right - and that is deliberate, not incidental.
      //
      // The numbers are `text-align: right`, which makes the left side of their gutter
      // ragged whitespace that varies with digit count. A glyph column over there floats
      // a different distance from the digits in every file. On the right it is always
      // flush against them, so the number and its marker read as one thing. The cost is
      // that the numbers sit a column off the code, which is why DIAGNOSTIC_GUTTER_PX is
      // as narrow as a 6px dot allows rather than a comfortable width.
      //
      // Unconditional: diagnostics are pushed, so unlike hover they need no pointer and
      // work on every platform. With nothing pushed the gutter renders only its spacer.
      createDiagnosticsExtension({ readTheme: () => activeTheme }),
      // Also unconditional, and for the same reason: every mark it draws comes from state
      // this editor already holds, and a thumb showing where you are is worth as much on
      // a phone as on a desktop.
      createOverviewRulerExtension({ readTheme: () => activeTheme }),
      EditorView.domEventHandlers({
        mousedown: (event, v) => {
          // Match the convention used by Rider and other IDEs: Ctrl-click on
          // Windows/Linux and Cmd-click on macOS follows the symbol under the
          // pointer. The existing host callback owns the LSP/index lookup, so
          // this remains provider- and language-server agnostic.
          if (!options.onGoToDefinitionShortcut || (!event.ctrlKey && !event.metaKey)) {
            return false;
          }
          const pos = v.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos === null) {
            return false;
          }
          v.dispatch({ selection: { anchor: pos }, userEvent: "select.pointer" });
          v.focus();
          options.onGoToDefinitionShortcut();
          event.preventDefault();
          return true;
        },
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
      // Always mounted, and seeded from the option: the field is what the toggle
      // flips, and mounting it conditionally would mean a remount to turn live
      // preview on. The plugin costs nothing while the field is false.
      markdownLivePreviewExtension(options.markdownLivePreview ?? false),
      // Ordered ahead of the HTML paste handler on purpose. Copying an image
      // out of a browser puts both an image file and an `<img>` tag on the
      // clipboard; writing the image into the workspace gives a document that
      // still renders offline, where the HTML conversion would leave it
      // pointing at someone else's server.
      markdownImageDropHandler(options.onImageDrop),
      // Declines in a non-markdown file and for structure-free clipboard HTML,
      // so CodeMirror keeps its ordinary paste in both cases.
      markdownPasteHandler,
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
  let vimModeCleanup: (() => void) | null = null;

  const attachVimMode = (enabled: boolean): void => {
    vimModeCleanup?.();
    vimModeCleanup = null;
    if (!enabled) {
      options.onVimModeChanged?.(null);
      return;
    }
    const cm = getCM(view);
    if (!cm) {
      options.onVimModeChanged?.("NORMAL");
      return;
    }
    const handleModeChange = (event: { mode?: string }): void => {
      options.onVimModeChanged?.(normalizeVimMode(event.mode));
    };
    cm.on("vim-mode-change", handleModeChange);
    vimModeCleanup = () => cm.off("vim-mode-change", handleModeChange);
    options.onVimModeChanged?.(normalizeVimMode(cm.state.vim?.mode));
  };

  attachVimMode(vimKeybindings);

  // Reuse the document's own rope as the baseline in the ordinary case (nothing
  // recovered, so the two are the same text) - see the `cleanDoc` note above.
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

  // Diagnostics already known at mount. A reopened tab has them in the client store
  // before the editor exists, and waiting for the server to republish would leave a
  // known-broken file looking clean for as long as the server felt like taking.
  if (options.diagnostics !== undefined && options.diagnostics.length > 0) {
    view.dispatch({ effects: setEditorDiagnostics.of(options.diagnostics) });
  }

  /**
   * Focus, and keep asking for a few frames.
   *
   * A single `view.focus()` is enough when the editor is already on screen, and
   * not enough when it has only just mounted: navigating to a file opens the
   * pane, mounts the editor and calls this in one pass, while the element the
   * click landed on is still being torn down - the browser hands focus back to
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
      // Reported from `from`/`to`, not anchor/head: a selection dragged upward
      // has head before anchor, and "add selection to chat" wants the range in
      // document order, the way the user reads it.
      const startLine = view.state.doc.lineAt(range.from);
      const endLine = view.state.doc.lineAt(range.to);
      return {
        text: view.state.sliceDoc(range.from, range.to),
        lineStart: startLine.number,
        lineEnd: endLine.number,
        columnStart: range.from - startLine.from + 1,
        columnEnd: range.to - endLine.from + 1,
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
      // disk), so the text it just wrote is the new baseline - and reusing the
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
        // asks for no reveal at all - not even the nudge, which would still
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
      activeTheme = spec;
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
    setVimKeybindings: (enabled) => {
      vimKeybindings = enabled;
      vimMappingExtension.dispose();
      vimMappingExtension = buildVimMappings(
        vimMappings,
        enabled ? options.onVimAction : undefined,
        options.onVimMappingPendingChanged,
      );
      view.dispatch({
        effects: [
          vimCompartment.reconfigure(enabled ? vim() : []),
          vimShortcutCompartment.reconfigure(
            enabled
              ? buildVimOttoShortcutHandlers(
                  options,
                  options.keyBindings ?? DEFAULT_EDITOR_KEY_BINDINGS,
                  () => findActive,
                )
              : [],
          ),
          vimMappingCompartment.reconfigure(vimMappingExtension.extension),
        ],
      });
      attachVimMode(enabled);
    },
    setVimMappings: (settings) => {
      vimMappings = settings;
      vimMappingExtension.dispose();
      vimMappingExtension = buildVimMappings(
        vimMappings,
        vimKeybindings ? options.onVimAction : undefined,
        options.onVimMappingPendingChanged,
      );
      if (vimKeybindings) {
        view.dispatch({
          effects: vimMappingCompartment.reconfigure(vimMappingExtension.extension),
        });
      }
    },
    setKeyBindings: (bindings) => {
      view.dispatch({
        effects: [
          keymapCompartment.reconfigure(buildShortcutKeymap(options, bindings)),
          ...(vimKeybindings
            ? [
                vimShortcutCompartment.reconfigure(
                  buildVimOttoShortcutHandlers(options, bindings, () => findActive),
                ),
              ]
            : []),
        ],
      });
    },
    setMarkdownLivePreview: (enabled) => {
      view.dispatch({ effects: setMarkdownLivePreview.of(enabled) });
    },
    setMarkdownLinkTargets: (paths) => {
      // The field only exists in a markdown editor, and dispatching an effect
      // nothing reads is a no-op, so the host can push unconditionally.
      view.dispatch({ effects: setMarkdownLinkTargetsEffect.of(paths) });
    },
    runMarkdownCommand: (name) => {
      // Focus first: the toolbar button took focus on press, and a command that
      // edits the document while the editor is blurred leaves the caret nowhere.
      view.focus();
      return getMarkdownCommand(name)(view);
    },
    setDiagnostics: (diagnostics) => {
      view.dispatch({ effects: setEditorDiagnostics.of(diagnostics) });
    },
    destroy: () => {
      destroyed = true;
      vimMappingExtension.dispose();
      vimModeCleanup?.();
      vimModeCleanup = null;
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

/**
 * The language server's explanation, on pointer rest. Markdown is rendered as plain
 * text with the fences stripped rather than through the app's markdown pipeline: this
 * module is bundled into the webview and must stay free of React and app imports, and
 * a hover is a glance rather than a document.
 *
 * `hoverTooltip` is pointer-driven, so this contributes nothing on touch platforms -
 * which is correct, not a gap. A long-press affordance would be a different feature.
 *
 * ## Why this is not just `await provider(...)`
 *
 * A cold language server answers in seconds, not milliseconds, and awaiting the source
 * means CM6 has nothing to show for all of it. Worse, `HoverPlugin.update` drops a
 * pending source promise on ANY view update and restarts the hover 20ms later, so on a
 * cold server the answer was routinely thrown away and re-asked forever - which is why
 * hovering early showed nothing at all rather than showing up late.
 *
 * So: race the provider against a short grace period. Answer inside the grace and the
 * tooltip is built from the finished content, exactly as before - the warm path never
 * flashes a placeholder and never renders an extra frame. Miss it and we return the
 * tooltip SYNCHRONOUSLY with a pending body and fill it in when the answer lands. A
 * synchronous return also has no pending promise for `update` to cancel, which is what
 * makes the cold case converge at all.
 */
function buildHoverTooltip(
  provider: (position: { line: number; column: number }) => Promise<EditorHoverAnswer>,
  readTheme: () => EditorThemeSpec,
  documentPath: string,
): Extension {
  return hoverTooltip(async (view, pos) => {
    // Problems come first, and from local state - they are already here, so they never
    // wait on a request. This is also the only tooltip that can appear on punctuation:
    // a stray brace or a missing semicolon is not an identifier, and "identifiers only"
    // is a rule about the *server's* hover, not about errors.
    const diagnostics = diagnosticsAtPos(view.state, pos);
    const word = view.state.wordAt(pos);

    if (word === null) {
      return diagnostics.length === 0
        ? null
        : {
            pos,
            end: Math.min(pos + 1, view.state.doc.length),
            above: true,
            create: () => ({ dom: renderDiagnosticList(diagnostics, readTheme()) }),
          };
    }

    const line = view.state.doc.lineAt(pos);
    const position = { line: line.number, column: pos - line.from + 1 };

    const pending = provider(position);
    const first = await Promise.race([pending, delay(HOVER_GRACE_MS).then((): null => null)]);

    if (first !== null) {
      if (first.kind === "content") {
        return hoverTooltipAt(word, () => {
          const spec = readTheme();
          return {
            dom: withDiagnostics(
              diagnostics,
              renderHoverContent(first.markdown, spec, documentPath),
              spec,
            ),
          };
        });
      }
      return diagnostics.length === 0
        ? null
        : hoverTooltipAt(word, () => ({
            dom: renderDiagnosticList(diagnostics, readTheme()),
          }));
    }

    // Slow server. When there is a problem here, that is what the user is asking about -
    // show it now rather than making them wait behind a type signature they did not ask for.
    if (diagnostics.length > 0) {
      return hoverTooltipAt(word, () => ({
        dom: renderDiagnosticList(diagnostics, readTheme()),
      }));
    }

    return hoverTooltipAt(word, () =>
      createFillingHoverView({ view, provider, position, pending, readTheme, documentPath }),
    );
  });
}

/**
 * Problems above the explanation, in one card. Two stacked tooltips for one pointer rest
 * is the thing `@codemirror/lint` would have given us; this is why we render our own.
 */
function withDiagnostics(
  diagnostics: readonly EditorDiagnostic[],
  content: HTMLElement,
  spec: EditorThemeSpec,
): HTMLElement {
  if (diagnostics.length === 0) {
    return content;
  }

  const card = renderDiagnosticList(diagnostics, spec);
  const divider = document.createElement("div");
  divider.className = "cm-otto-hover-divider";
  card.appendChild(divider);
  card.append(...content.childNodes);
  return card;
}

interface FillingHoverInput {
  view: EditorView;
  provider: (position: { line: number; column: number }) => Promise<EditorHoverAnswer>;
  position: { line: number; column: number };
  /** The ask already in flight, so missing the grace period costs no extra request. */
  pending: Promise<EditorHoverAnswer>;
  readTheme: () => EditorThemeSpec;
  /** Fallback grammar for a code segment the server left untagged. */
  documentPath: string;
}

/**
 * A tooltip that exists before its content does. Shows the pending state, swaps in the
 * explanation when it lands, re-asks while the server reports itself still indexing, and
 * retracts itself if the answer turns out to be "nothing" - an empty frame left sitting
 * over the code is the one outcome worse than no tooltip.
 */
function createFillingHoverView(input: FillingHoverInput): TooltipView {
  const { view, provider, position, pending, readTheme, documentPath } = input;
  const host = createPendingHover(readTheme());
  const giveUpAt = Date.now() + HOVER_RETRY_CEILING_MS;
  let disposed = false;

  function fail(): void {
    settle({ kind: "unavailable" });
  }

  function askAgain(): void {
    if (!disposed) {
      provider(position).then(settle, fail);
    }
  }

  function settle(answer: EditorHoverAnswer): void {
    if (disposed) {
      return;
    }
    if (answer.kind === "content") {
      host.replaceWith(renderHoverContent(answer.markdown, readTheme(), documentPath));
      return;
    }
    if (answer.kind === "warming" && Date.now() < giveUpAt) {
      // Still booting or indexing. Hold the tooltip and ask again - the pointer is
      // resting on the same word, so the user's question has not changed.
      window.setTimeout(askAgain, HOVER_RETRY_MS);
      return;
    }
    view.dispatch({ effects: closeHoverTooltips });
  }

  pending.then(settle, fail);

  return {
    dom: host.dom,
    destroy: () => {
      disposed = true;
    },
  };
}

/**
 * Anchored to the whole word, not the character under the pointer, so CM6's
 * `isOverRange` check keeps the tooltip up while the pointer drifts across the
 * identifier - which matters far more once the tooltip can outlive the request.
 */
function hoverTooltipAt(
  word: { from: number; to: number },
  create: () => { dom: HTMLElement; destroy?: () => void },
): { pos: number; end: number; above: boolean; create: () => TooltipView } {
  return { pos: word.from, end: word.to, above: true, create };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * The waiting state: a spinner and a word, sized close enough to a one-line signature
 * that filling it in reads as content arriving rather than as the tooltip jumping.
 * The tooltip plugin keeps a ResizeObserver on each tooltip's DOM, so the swap
 * repositions itself - nothing here has to re-measure.
 */
function createPendingHover(spec: EditorThemeSpec): {
  dom: HTMLElement;
  replaceWith: (content: HTMLElement) => void;
} {
  const dom = document.createElement("div");
  dom.className = "cm-otto-hover cm-otto-hover-pending";

  const spinner = document.createElement("span");
  spinner.className = "cm-otto-hover-spinner";
  dom.appendChild(spinner);

  const label = document.createElement("span");
  label.textContent = "Loading…";
  label.style.fontSize = `${Math.max(11, spec.fontSize - 1)}px`;
  dom.appendChild(label);

  return {
    dom,
    replaceWith: (content) => {
      dom.className = content.className;
      dom.replaceChildren(...content.childNodes);
    },
  };
}

/**
 * Hover content as sections rather than one run of text. A signature and a paragraph of
 * documentation are different things and now look like it: the fenced block is real
 * highlighted code in the editor's own syntax colours, the prose is proportional and
 * muted, and a rule separates them.
 *
 * Built as DOM by hand because this module is bundled into the native webview: no React,
 * no app markdown pipeline, and no stylesheet from outside CM6.
 */
/**
 * `documentPath` is the fallback grammar for a code segment the server did not tag. csharp-ls
 * emits its signature as an untagged code span, and a signature in a `.cs` tab is C# - guessing
 * that is strictly better than rendering it uncoloured next to a highlighted TypeScript hover.
 */
function renderHoverContent(
  markdown: string,
  spec: EditorThemeSpec,
  documentPath: string,
): HTMLElement {
  const root = document.createElement("div");
  root.className = "cm-otto-hover";

  const segments = parseHoverMarkdown(markdown);
  segments.forEach((segment, index) => {
    if (index > 0) {
      const divider = document.createElement("div");
      divider.className = "cm-otto-hover-divider";
      root.appendChild(divider);
    }
    root.appendChild(
      segment.kind === "code"
        ? renderHoverCode(segment, spec, documentPath)
        : renderHoverProse(segment),
    );
  });

  return root;
}

/**
 * The signature, highlighted with the same tokenizer and the same colours as the buffer
 * behind it - so a type in a hover is the colour that type is in the code.
 */
function renderHoverCode(
  segment: HoverCodeSegment,
  spec: EditorThemeSpec,
  documentPath: string,
): HTMLElement {
  const pre = document.createElement("pre");
  pre.className = "cm-otto-hover-code";

  const filename = filenameForHoverLanguage(segment.language) ?? documentPath;
  if (filename === null) {
    // An untagged or unsupported fence is still code: keep it mono, just uncoloured.
    pre.textContent = segment.text;
    return pre;
  }

  const lines = highlightCode(segment.text, filename);
  lines.forEach((tokens, index) => {
    if (index > 0) {
      pre.appendChild(document.createTextNode("\n"));
    }
    for (const token of tokens) {
      if (token.style === null) {
        pre.appendChild(document.createTextNode(token.text));
        continue;
      }
      const span = document.createElement("span");
      span.textContent = token.text;
      span.style.color = spec.syntax[token.style];
      pre.appendChild(span);
    }
  });

  return pre;
}

function renderHoverProse(segment: HoverProseSegment): HTMLElement {
  const block = document.createElement("div");
  block.className = "cm-otto-hover-prose";
  block.textContent = plainProse(segment.text);
  return block;
}
