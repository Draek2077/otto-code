import type { SyntaxColors } from "@otto-code/highlight";

// Shared contract between the editor hosts (web DOM mount, native webview) and
// the CM6 core. This module is bundled into the native webview HTML — keep it
// free of React, React Native, and app-store imports.

export interface EditorThemeSpec {
  background: string;
  foreground: string;
  /**
   * Line-number gutter fill. Kept separate from `background` on purpose: the
   * code area sits in a deepened well (see editor-theme) while the gutter stays
   * at the surrounding chrome color, so the line numbers read as a margin
   * rather than as part of the darker code surface.
   */
  gutterBackground: string;
  gutterForeground: string;
  gutterActiveForeground: string;
  /** Divider line between the line-number gutter and the code. */
  gutterBorder: string;
  /** Character column for the line-length ruler; null hides it entirely. */
  rulerColumn: number | null;
  /** Ruler stripe color — the gutter divider at half strength. */
  rulerColor: string;
  /**
   * Width of the overview ruler — the annotation lane down the right edge — in px.
   * `0` removes it entirely, lane reservation included, which is the off switch:
   * the same idiom as `rulerColumn: null`.
   *
   * A dimension in the theme rather than a constant in the extension because it is
   * the one value a host has a reason to change: a touch host wants a wider target
   * than a pointer host does.
   */
  overviewRulerWidth: number;
  /** Lane fill. The gutter colour, so the lane reads as the margin's continuation. */
  overviewRulerBackground: string;
  /** Hairline on the lane's inner edge — the gutter divider, mirrored. */
  overviewRulerBorder: string;
  /**
   * Viewport indicator fill. MUST stay translucent: it is painted over the marks,
   * and an opaque thumb hides exactly the problems that are on screen.
   */
  overviewRulerThumb: string;
  /** Caret position mark. The cursor colour, so the lane's "you are here" matches the caret's. */
  overviewRulerCursor: string;
  /**
   * Selected-range bands in the lane. The editor's own selection fill, so the band
   * is recognisably the selection rather than a fifth kind of mark — and translucent
   * for the same reason as the thumb: it is painted behind the marks, and a problem
   * inside the selection has to stay visible.
   */
  overviewRulerSelection: string;
  /** Search-hit marks in the lane. The match outline, which is solid enough to survive 3px. */
  overviewRulerMatch: string;
  /**
   * Scrollbar thumb for surfaces CM6 owns, chiefly the hover tooltip. Threaded
   * through the theme rather than read from the app store because this module is
   * bundled into the native webview, where the app's styles and theme do not reach.
   */
  scrollbarHandle: string;
  /**
   * Fill for CM6-owned floating surfaces (the hover tooltip). Deliberately NOT
   * `background`: the code area sits in a deepened well, so a tooltip painted the
   * same colour reads as a hole in the text with a hairline around it. This is the
   * app's elevated-surface token, which is lighter than the well.
   */
  tooltipBackground: string;
  /** Border for those surfaces — the real border colour, not the ruler half-strength. */
  tooltipBorder: string;
  /**
   * CSS `box-shadow` for those surfaces, composed from the app's `md` elevation
   * token. A string rather than the token itself because CM6 styles a DOM the
   * app's stylesheet never reaches.
   */
  tooltipShadow: string;
  selectionBackground: string;
  cursor: string;
  /**
   * Caret width in px. A 1px hairline is genuinely hard to find in a wall of
   * monospace text — this is the one dimension that makes the caret locatable
   * at a glance, so it is themeable rather than left at CM6's 1.2px default.
   */
  cursorWidth: number;
  activeLineBackground: string;
  /**
   * Search-match fills. These must NOT resemble `selectionBackground` — a match
   * that looks like a selection is invisible while you are also selecting, which
   * is precisely when you are searching. They are amber (the semantic warning
   * tone) against the neutral selection, and each fill is paired with an outline
   * so a match is legible even where the fill lands on a busy syntax color.
   */
  searchMatchBackground: string;
  searchMatchBorder: string;
  activeSearchMatchBackground: string;
  activeSearchMatchBorder: string;
  /** CSS font-family stack; must end in a generic mono fallback — the native
   * webview document cannot resolve Expo-registered font names. */
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  syntax: SyntaxColors;
  /** Squiggle and gutter-glyph colours per problem severity. */
  diagnostic: Record<EditorDiagnosticSeverity, string>;
}

export type EditorDiagnosticSeverity = "error" | "warning" | "info" | "hint";

/**
 * One problem a language server reported, 1-based — the editor's mirror of the protocol's
 * `CodeDiagnostic`, restated here because this module is the webview's contract and may not
 * import from the protocol package.
 */
export interface EditorDiagnostic {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: EditorDiagnosticSeverity;
  message: string;
  /** Which tool says so — `ts`, `oxc`. */
  source?: string;
  /** That tool's rule or error code. */
  code?: string;
  /** Documentation for the rule, when the server offered one. */
  codeHref?: string;
}

export interface EditorFindState {
  search: string;
  replace: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
}

export interface EditorMatchInfo {
  /** 1-based index of the active match; 0 when the selection is not on a match. */
  current: number;
  total: number;
}

/**
 * Where the caret is, for the status bar. Pushed on every selection change —
 * unlike `EditorSelection` (pull-only) and `EditorPointerSelect` (pointer only),
 * both of which miss plain keyboard movement.
 */
export interface EditorCursorPosition {
  /** 1-based line of the selection head. */
  line: number;
  /** 1-based column of the selection head, counted in UTF-16 code units. */
  column: number;
  /** Characters currently selected; 0 when the caret is collapsed. */
  selectedChars: number;
  /** Number of lines the selection spans; 0 when the caret is collapsed. */
  selectedLines: number;
}

/**
 * Imperative surface both hosts expose to the app. `getDoc` is async because
 * the native host resolves it over the webview bridge.
 */
export interface EditorSelection {
  /** Selected text; empty when the cursor has no selection. */
  text: string;
  /** 1-based line of the selection start. */
  lineStart: number;
  /** 1-based line of the selection end. */
  lineEnd: number;
  /** True when nothing is selected (just a cursor). */
  isEmpty: boolean;
}

/** Snapshot of the editor viewport used by the split-view scroll sync. */
export interface EditorScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  /** 1-based first (partially) visible line. */
  topLine: number;
  lineCount: number;
}

/**
 * A pointer placed the cursor; carries where that landed so the preview can
 * align the equivalent content at the same viewport height.
 */
export interface EditorPointerSelect {
  /** 1-based line the cursor landed on. */
  line: number;
  lineCount: number;
  /** Distance from the top of the editor viewport to that line, px. */
  viewportOffsetY: number;
}

/**
 * What the language server had to say about a hovered position. Four cases rather
 * than "markdown or nothing", because the tooltip treats them differently: only
 * `warming` is worth waiting on, and only `none`/`unavailable` mean "take the tooltip
 * away". Collapsing them is what made a cold editor silently show nothing.
 */
export type EditorHoverAnswer =
  /** The server explained the symbol. */
  | { kind: "content"; markdown: string }
  /** The server answered and had nothing to say about this position. */
  | { kind: "none" }
  /** A server is bound but still starting or indexing — the same ask will work later. */
  | { kind: "warming" }
  /** No server covers this file, or the request failed. Asking again will not help. */
  | { kind: "unavailable" };

/**
 * The editor commands whose key is Otto's to choose, and therefore the user's to
 * rebind. Each one is a "File Editor" row in the shortcut registry and a host
 * callback on `CodeEditorProps`; the core only knows how to wire the two together.
 *
 * Not in here: CodeMirror's `defaultKeymap` (select line, undo, indent, the
 * clipboard) and Escape-closes-find. Those are the platform's editor bindings
 * rather than Otto's, and they keep working untouched — see editor-core's keymap.
 */
export type EditorKeyAction =
  | "save"
  | "find"
  | "goToLine"
  | "goToDefinition"
  | "findReferences"
  | "renameSymbol"
  | MarkdownCommandName;

/**
 * Markdown formatting the editor performs itself.
 *
 * Unlike every other `EditorKeyAction`, these are NOT forwarded to the host:
 * the core runs them against its own document. They also DECLINE outside
 * markdown context, which is what lets `Mod-b` mean bold in a `.md` file and
 * fall through to Go to definition in a `.ts` one from a single keymap.
 *
 * The same names are the toolbar's vocabulary, through
 * `EditorController.runMarkdownCommand`, so a button and a key run identical
 * code.
 */
export type MarkdownCommandName =
  | "markdownBold"
  | "markdownItalic"
  | "markdownCode"
  | "markdownStrikethrough"
  | "markdownLink"
  | "markdownImage"
  | "markdownBulletList"
  | "markdownOrderedList"
  | "markdownTaskList"
  | "markdownToggleTask"
  | "markdownBlockquote"
  | "markdownCodeFence"
  | "markdownHorizontalRule"
  | "markdownTable"
  | "markdownHeading1"
  | "markdownHeading2"
  | "markdownHeading3"
  | "markdownHeading4"
  | "markdownHeading5"
  | "markdownHeading6";

export interface EditorKeyBinding {
  action: EditorKeyAction;
  /** A CodeMirror key name — "Mod-s", "Shift-F12", "F2". */
  key: string;
}

/**
 * What the editor binds when the host supplies no bindings of its own: the
 * native webview, which has no shortcut registry to read, and tests.
 *
 * These MUST stay in step with the File Editor section of `SHORTCUT_BINDINGS`
 * (keyboard/keyboard-shortcuts.ts) — the registry is the source of truth and
 * this is its restatement for hosts that cannot reach it. editor-key-bindings.test.ts
 * asserts the two agree, so a default changed in one place fails there rather
 * than silently giving phones a different editor from desktops.
 */
export const DEFAULT_EDITOR_KEY_BINDINGS: readonly EditorKeyBinding[] = [
  // Markdown first, and the order matters: `Mod-b` appears twice, and the
  // markdown command declines outside markdown so the second entry gets the key
  // in a code file. Same reason the Markdown Editor section precedes File Editor
  // in the registry.
  { action: "markdownBold", key: "Mod-b" },
  { action: "markdownItalic", key: "Mod-i" },
  { action: "markdownCode", key: "Mod-Shift-c" },
  { action: "markdownStrikethrough", key: "Mod-Shift-x" },
  { action: "markdownLink", key: "Mod-k" },
  { action: "markdownBulletList", key: "Mod-Shift-u" },
  { action: "markdownOrderedList", key: "Mod-Shift-o" },
  { action: "markdownTaskList", key: "Mod-Shift-l" },
  { action: "markdownToggleTask", key: "Mod-Enter" },
  { action: "markdownBlockquote", key: "Mod-Shift-q" },
  { action: "save", key: "Mod-s" },
  { action: "find", key: "Mod-f" },
  { action: "goToLine", key: "Mod-g" },
  { action: "goToDefinition", key: "Mod-b" },
  { action: "goToDefinition", key: "F12" },
  { action: "findReferences", key: "Shift-F12" },
  { action: "renameSymbol", key: "F2" },
];

export interface EditorController {
  getDoc(): Promise<string>;
  /** Current primary selection (for AI Refactor scoping). */
  getSelection(): Promise<EditorSelection>;
  /**
   * The identifier under the caret, or `""` when the caret is not in one.
   * Drives go-to-definition, whose daemon-side index is name-based — see
   * word-at-cursor.ts for why nothing smarter belongs here.
   */
  getWordAtCursor(): Promise<string>;
  /** Replace the whole document (revert/reload) and reset the dirty baseline. */
  setDoc(doc: string): void;
  setFind(find: EditorFindState | null): void;
  findNext(): void;
  findPrevious(): void;
  replaceNext(): void;
  replaceAll(): void;
  focus(): void;
  /** Scroll to and place the cursor on a 1-based line (outline navigation). */
  goToLine(line: number): void;
  /**
   * Scroll to and *select* an inclusive 1-based line range, then focus. Where
   * `goToLine` says "you are here", this says "this is the thing" — the span is
   * highlighted and a single keystroke replaces it. Used when a caller knows
   * the extent of what it sent you to (a finding, a diff hunk).
   */
  /**
   * `reveal` (default true) is what makes this a jump. Pass false when the
   * range is already what the user is looking at — selecting the line under the
   * pointer must not scroll the page out from under them.
   */
  selectLines(startLine: number, endLine: number, options?: { reveal?: boolean }): void;
  /** Select the whole document, then focus (context menu "Select all"). */
  selectAll(): void;
  /**
   * Overwrite the primary selection — insertion when it is empty. The host owns
   * the clipboard (one API across web and native), so cut and paste are this
   * plus a clipboard read or write.
   */
  replaceSelection(text: string): void;
  /**
   * Run a markdown formatting command — the formatting toolbar's entry point,
   * and the same code the keymap runs, so a button and a key can never diverge.
   *
   * Deliberately fire-and-forget rather than reporting whether the command
   * applied: the answer would have to cross the native bridge as a reply, and
   * nothing in the UI acts on it. A command that declines (outside markdown, or
   * with nothing to change) simply leaves the document alone.
   */
  runMarkdownCommand(name: MarkdownCommandName): void;
  // Split-view scroll sync. Optional: the web host implements these; the
  // native webview host does not (split view is web/desktop only).
  getScrollMetrics?(): EditorScrollMetrics | null;
  /** Scroll so `fraction` (0..1) of the scrollable range is above the viewport. */
  scrollToFraction?(fraction: number): void;
  /** Scroll so the given 1-based line sits `viewportOffsetY` px below the viewport top. */
  scrollToLineAtOffset?(line: number, viewportOffsetY: number): void;
  /**
   * Replace the problem markers. Always the document's whole current set — the daemon
   * pushes snapshots, not deltas, so there is nothing to merge and nothing to retract.
   */
  setDiagnostics(diagnostics: readonly EditorDiagnostic[]): void;
}

export interface CodeEditorProps {
  /** Workspace-relative path; drives language detection. */
  path: string;
  initialDoc: string;
  /**
   * The saved text the document is dirty *against*, kept live: whenever the
   * buffer's baseline moves (a save lands, the disk version is adopted) pass the
   * new one and the editor re-derives dirty from it. It is the only way the
   * editor is told what clean means, which is what lets undoing an edit — or a
   * cut put back by a paste — report not-dirty again.
   *
   * Differs from `initialDoc` only when a recovered draft is mounted: then the
   * document is the draft and this is what is on disk.
   */
  cleanDoc: string;
  theme: EditorThemeSpec;
  /** Soft-wrap long lines instead of scrolling horizontally; live-togglable. */
  wordWrap: boolean;
  onDirtyChanged?: (dirty: boolean) => void;
  onMatchInfo?: (info: EditorMatchInfo | null) => void;
  /** Caret/selection moved; drives the status bar's Ln/Col readout. */
  onCursorMoved?: (position: EditorCursorPosition) => void;
  /**
   * Which key runs which of the callbacks below. Comes from the user's effective
   * shortcut registry (see editor/editor-key-bindings.ts), so a rebind in
   * Settings reaches the editor. Omitted means `DEFAULT_EDITOR_KEY_BINDINGS` —
   * which is what the native webview host uses, since a phone has no shortcuts
   * screen to rebind from.
   */
  keyBindings?: readonly EditorKeyBinding[];
  /** The `save` binding fired; the host owns the actual save. */
  onSaveShortcut?: () => void;
  /** The `find` binding fired; the host opens the find strip. */
  onFindShortcut?: () => void;
  /**
   * Escape inside the editor while find is running; the host closes the find
   * strip. Never fires when find is idle — Escape keeps its editing meaning
   * then. Not a rebindable binding for exactly that reason.
   */
  onCloseFindShortcut?: () => void;
  /** The `goToLine` binding fired; the host opens the go-to-line dialog. */
  onGoToLineShortcut?: () => void;
  /** The `goToDefinition` binding fired; the host runs go-to-definition. */
  onGoToDefinitionShortcut?: () => void;
  /**
   * The `findReferences` binding fired; the host opens the references tab. Wired
   * even when no language server covers the file — like go-to-definition, the
   * keystroke reaches the editor whether or not the menu item is offered, so the
   * capability gate lives in the host's handler.
   */
  onFindReferencesShortcut?: () => void;
  /** The `renameSymbol` binding fired; the host opens the rename dialog. */
  onRenameSymbolShortcut?: () => void;
  /**
   * Debounced buffer mirror. The document lives inside the editor (web DOM or
   * native webview); this keeps a recoverable copy outside it so host
   * remounts and webview crashes cannot lose edits. Never used for saves.
   */
  onDocSync?: (doc: string) => void;
  /** Override the doc-sync debounce (split view wants a livelier preview). */
  docSyncDebounceMs?: number;
  // Split-view scroll sync (web host only; see EditorController notes).
  onScrolled?: (metrics: EditorScrollMetrics) => void;
  onPointerSelect?: (select: EditorPointerSelect) => void;
  /**
   * Right-click inside the editor, in viewport coordinates. Web host only:
   * supplying it suppresses the platform menu, so the host must offer the edit
   * actions itself. Native keeps the platform's own text menu — a long-press
   * selection menu is what a phone user expects there.
   */
  onContextMenu?: (point: { x: number; y: number }) => void;
  /**
   * Resolve the language server's explanation for a 1-based position.
   * **Web/desktop only by construction** — CM6 drives this from pointer rest, and
   * pointer events do not fire on native (see CLAUDE.md); a touch equivalent would be
   * a long-press affordance, which is a different feature.
   */
  hoverProvider?: (position: { line: number; column: number }) => Promise<EditorHoverAnswer>;
  /**
   * Problems for this document. Unlike `hoverProvider` this works on every platform —
   * diagnostics are pushed, so they need no pointer.
   */
  diagnostics?: readonly EditorDiagnostic[];
  onReady?: (controller: EditorController) => void;
}

// Native webview bridge messages. One editor per webview.

export type EditorWebViewInbound =
  | {
      type: "mount";
      path: string;
      doc: string;
      cleanDoc: string;
      theme: EditorThemeSpec;
      wordWrap: boolean;
    }
  | { type: "setDoc"; doc: string }
  | { type: "setCleanDoc"; doc: string }
  | { type: "setTheme"; theme: EditorThemeSpec }
  | { type: "setWordWrap"; enabled: boolean }
  | { type: "setFind"; find: EditorFindState | null }
  | { type: "findNext" }
  | { type: "findPrevious" }
  | { type: "replaceNext" }
  | { type: "replaceAll" }
  | { type: "focus" }
  | { type: "goToLine"; line: number }
  | { type: "selectLines"; startLine: number; endLine: number; reveal?: boolean }
  | { type: "selectAll" }
  | { type: "replaceSelection"; text: string }
  | { type: "runMarkdownCommand"; name: MarkdownCommandName }
  | { type: "setDiagnostics"; diagnostics: readonly EditorDiagnostic[] }
  | { type: "getDoc"; requestId: number }
  | { type: "getSelection"; requestId: number }
  | { type: "getWordAtCursor"; requestId: number };

export type EditorWebViewOutbound =
  | { type: "bridgeReady" }
  | { type: "dirtyChanged"; dirty: boolean }
  | { type: "matchInfo"; info: EditorMatchInfo | null }
  | { type: "cursorMoved"; position: EditorCursorPosition }
  | { type: "saveShortcut" }
  | { type: "findShortcut" }
  | { type: "closeFindShortcut" }
  | { type: "goToLineShortcut" }
  | { type: "goToDefinitionShortcut" }
  | { type: "doc"; requestId: number; doc: string }
  | { type: "selection"; requestId: number; selection: EditorSelection }
  | { type: "wordAtCursor"; requestId: number; word: string }
  // Debounced buffer mirror so a webview render-process death cannot lose
  // edits; the host remounts from the last synced doc. Saves never read it —
  // they always round-trip getDoc for the exact buffer.
  | { type: "docSync"; doc: string };
