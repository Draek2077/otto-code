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
  // Split-view scroll sync. Optional: the web host implements these; the
  // native webview host does not (split view is web/desktop only).
  getScrollMetrics?(): EditorScrollMetrics | null;
  /** Scroll so `fraction` (0..1) of the scrollable range is above the viewport. */
  scrollToFraction?(fraction: number): void;
  /** Scroll so the given 1-based line sits `viewportOffsetY` px below the viewport top. */
  scrollToLineAtOffset?(line: number, viewportOffsetY: number): void;
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
  /** Mod-S inside the editor; the host owns the actual save. */
  onSaveShortcut?: () => void;
  /** Mod-F inside the editor; the host opens the find strip. */
  onFindShortcut?: () => void;
  /** Mod-G inside the editor; the host opens the go-to-line dialog. */
  onGoToLineShortcut?: () => void;
  /** Mod-B / F12 inside the editor; the host runs go-to-definition. */
  onGoToDefinitionShortcut?: () => void;
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
  | { type: "goToLineShortcut" }
  | { type: "goToDefinitionShortcut" }
  | { type: "doc"; requestId: number; doc: string }
  | { type: "selection"; requestId: number; selection: EditorSelection }
  | { type: "wordAtCursor"; requestId: number; word: string }
  // Debounced buffer mirror so a webview render-process death cannot lose
  // edits; the host remounts from the last synced doc. Saves never read it —
  // they always round-trip getDoc for the exact buffer.
  | { type: "docSync"; doc: string };
