import type { SyntaxColors } from "@otto-code/highlight";

// Shared contract between the editor hosts (web DOM mount, native webview) and
// the CM6 core. This module is bundled into the native webview HTML — keep it
// free of React, React Native, and app-store imports.

export interface EditorThemeSpec {
  background: string;
  foreground: string;
  gutterForeground: string;
  gutterActiveForeground: string;
  /** Divider line between the line-number gutter and the code. */
  gutterBorder: string;
  selectionBackground: string;
  cursor: string;
  activeLineBackground: string;
  searchMatchBackground: string;
  activeSearchMatchBackground: string;
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
  /** Replace the whole document (revert/reload) and reset the dirty baseline. */
  setDoc(doc: string): void;
  /** Reset the dirty baseline without touching the document (after save). */
  markClean(): void;
  setFind(find: EditorFindState | null): void;
  findNext(): void;
  findPrevious(): void;
  replaceNext(): void;
  replaceAll(): void;
  focus(): void;
  /** Scroll to and place the cursor on a 1-based line (outline navigation). */
  goToLine(line: number): void;
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
  theme: EditorThemeSpec;
  /** Soft-wrap long lines instead of scrolling horizontally; live-togglable. */
  wordWrap: boolean;
  onDirtyChanged?: (dirty: boolean) => void;
  onMatchInfo?: (info: EditorMatchInfo | null) => void;
  /** Mod-S inside the editor; the host owns the actual save. */
  onSaveShortcut?: () => void;
  /** Mod-F inside the editor; the host opens the find strip. */
  onFindShortcut?: () => void;
  /** Mod-G inside the editor; the host opens the go-to-line dialog. */
  onGoToLineShortcut?: () => void;
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
  onReady?: (controller: EditorController) => void;
}

// Native webview bridge messages. One editor per webview.

export type EditorWebViewInbound =
  | {
      type: "mount";
      path: string;
      doc: string;
      theme: EditorThemeSpec;
      wordWrap: boolean;
    }
  | { type: "setDoc"; doc: string }
  | { type: "markClean" }
  | { type: "setTheme"; theme: EditorThemeSpec }
  | { type: "setWordWrap"; enabled: boolean }
  | { type: "setFind"; find: EditorFindState | null }
  | { type: "findNext" }
  | { type: "findPrevious" }
  | { type: "replaceNext" }
  | { type: "replaceAll" }
  | { type: "focus" }
  | { type: "goToLine"; line: number }
  | { type: "getDoc"; requestId: number }
  | { type: "getSelection"; requestId: number };

export type EditorWebViewOutbound =
  | { type: "bridgeReady" }
  | { type: "dirtyChanged"; dirty: boolean }
  | { type: "matchInfo"; info: EditorMatchInfo | null }
  | { type: "saveShortcut" }
  | { type: "findShortcut" }
  | { type: "goToLineShortcut" }
  | { type: "doc"; requestId: number; doc: string }
  | { type: "selection"; requestId: number; selection: EditorSelection }
  // Debounced buffer mirror so a webview render-process death cannot lose
  // edits; the host remounts from the last synced doc. Saves never read it —
  // they always round-trip getDoc for the exact buffer.
  | { type: "docSync"; doc: string };
