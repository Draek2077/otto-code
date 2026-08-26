import type { ShortcutKey } from "@/utils/format-shortcut";
import type {
  KeyboardActionId,
  KeyboardFocusScope,
  KeyboardShortcutPayload,
  MessageInputKeyboardActionKind,
} from "@/keyboard/actions";
import {
  chordStringToShortcutKeys,
  type KeyCombo,
  parseChordString,
} from "@/keyboard/shortcut-string";

export type { KeyCombo } from "@/keyboard/shortcut-string";

// --- Public types ---

export interface KeyboardShortcutContext {
  isMac: boolean;
  isDesktop: boolean;
  focusScope: KeyboardFocusScope;
  commandCenterOpen: boolean;
}

export interface KeyboardShortcutInput {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
}

export interface KeyboardShortcutMatch {
  action: KeyboardActionId;
  payload: KeyboardShortcutPayload;
  preventDefault: boolean;
  stopPropagation: boolean;
}

export interface KeyboardShortcutHelpRow {
  id: string;
  label: string;
  labelKey: string;
  chord: ShortcutKey[][] | null;
  /** @deprecated Use chord; retained while older shortcut surfaces migrate. */
  keys?: ShortcutKey[];
  note?: string;
  noteKey?: string;
}

export type ShortcutSectionId =
  | "navigation"
  | "tabs-panes"
  | "projects"
  | "panels"
  | "layout"
  | "editor"
  | "markdown-editor"
  | "agent-input";

export interface KeyboardShortcutHelpSection {
  id: ShortcutSectionId;
  title: string;
  titleKey: string;
  rows: KeyboardShortcutHelpRow[];
}

// --- Binding definition types ---

interface KeyboardShortcutPlatformContext {
  isMac: boolean;
  isDesktop: boolean;
}

interface ShortcutWhen {
  /** true = mac only, false = non-mac only */
  mac?: boolean;
  /** true = desktop only, false = web only */
  desktop?: boolean;
  /** false = disabled when a text-editing surface is focused (the file editor counts) */
  editable?: false;
  /** false = disabled when terminal is focused */
  terminal?: false;
  /** false = disabled when command center is open */
  commandCenter?: false;
  /**
   * Exact focus scope match - and the binding's SPECIFICITY. A binding that
   * names the focused surface beats one that applies everywhere on the same
   * combo (see `bindingSpecificity`), which is how the File Editor section
   * overrides the general bindings while the editor has focus. Nothing else in
   * this file needs a per-binding "not in the editor" guard because of it.
   */
  focusScope?: KeyboardFocusScope;
}

type ShortcutPayloadDef =
  | { type: "index" }
  | { type: "delta"; delta: 1 | -1 }
  | { type: "message-input"; kind: MessageInputKeyboardActionKind };

interface ShortcutHelp {
  id: string;
  section: ShortcutSectionId;
  label: string;
  keys: ShortcutKey[];
  defaultDisplayKeys?: ShortcutKey[];
  note?: string;
}

interface ShortcutBinding {
  id: string;
  action: KeyboardActionId;
  combo: string;
  repeat?: false;
  when?: ShortcutWhen;
  payload?: ShortcutPayloadDef;
  preventDefault?: boolean;
  stopPropagation?: boolean;
  help?: ShortcutHelp;
}

export interface ParsedShortcutBinding extends ShortcutBinding {
  parsedChord: KeyCombo[];
}

export interface ChordState {
  candidateIndices: number[];
  step: number;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

// --- Constants ---

const SHORTCUT_HELP_SECTION_TITLES: Record<ShortcutSectionId, string> = {
  navigation: "Navigation",
  "tabs-panes": "Tabs & Panes",
  projects: "Projects",
  panels: "Panels",
  layout: "Layout",
  editor: "File Editor",
  "markdown-editor": "Markdown Editor",
  "agent-input": "Agent Input",
};

const SHORTCUT_HELP_SECTION_LABEL_KEYS: Record<ShortcutSectionId, string> = {
  navigation: "settings.shortcuts.sections.navigation",
  "tabs-panes": "settings.shortcuts.sections.tabsPanes",
  projects: "settings.shortcuts.sections.projects",
  panels: "settings.shortcuts.sections.panels",
  layout: "settings.shortcuts.sections.layout",
  editor: "settings.shortcuts.sections.editor",
  "markdown-editor": "settings.shortcuts.sections.markdownEditor",
  "agent-input": "settings.shortcuts.sections.agentInput",
};

export const SHORTCUT_HELP_LABEL_KEYS: Record<string, string> = {
  "new-agent": "settings.shortcuts.help.openProject",
  "new-workspace": "settings.shortcuts.help.newWorkspace",
  "switch-project": "settings.shortcuts.help.switchProject",
  "archive-workspace": "settings.shortcuts.help.archiveWorkspace",
  "workspace-tab-new": "settings.shortcuts.help.newTab",
  "workspace-tab-close-current": "settings.shortcuts.help.closeCurrentTab",
  "workspace-jump-index": "settings.shortcuts.help.jumpToWorkspace",
  "workspace-tab-jump-index": "settings.shortcuts.help.jumpToTab",
  "workspace-prev": "settings.shortcuts.help.previousWorkspace",
  "workspace-next": "settings.shortcuts.help.nextWorkspace",
  "workspace-tab-prev": "settings.shortcuts.help.previousTab",
  "workspace-tab-next": "settings.shortcuts.help.nextTab",
  "workspace-pane-split-right": "settings.shortcuts.help.splitPaneRight",
  "workspace-pane-split-down": "settings.shortcuts.help.splitPaneDown",
  "workspace-pane-focus-left": "settings.shortcuts.help.focusPaneLeft",
  "workspace-pane-focus-right": "settings.shortcuts.help.focusPaneRight",
  "workspace-pane-focus-up": "settings.shortcuts.help.focusPaneUp",
  "workspace-pane-focus-down": "settings.shortcuts.help.focusPaneDown",
  "workspace-pane-move-tab-left": "settings.shortcuts.help.moveTabLeft",
  "workspace-pane-move-tab-right": "settings.shortcuts.help.moveTabRight",
  "workspace-pane-move-tab-up": "settings.shortcuts.help.moveTabUp",
  "workspace-pane-move-tab-down": "settings.shortcuts.help.moveTabDown",
  "workspace-pane-close": "settings.shortcuts.help.closePane",
  "workspace-terminal-new": "settings.shortcuts.help.newTerminal",
  "toggle-command-center": "settings.shortcuts.help.toggleCommandCenter",
  "show-shortcuts": "settings.shortcuts.help.showKeyboardShortcuts",
  "toggle-left-sidebar": "settings.shortcuts.help.toggleLeftSidebar",
  "toggle-right-sidebar": "settings.shortcuts.help.toggleRightSidebar",
  "toggle-both-sidebars": "settings.shortcuts.help.toggleBothSidebars",
  "open-files-sidebar": "settings.shortcuts.help.openFilesSidebar",
  "find-in-files": "settings.shortcuts.help.findInFiles",
  "open-changes-sidebar": "settings.shortcuts.help.openChangesSidebar",
  "toggle-focus": "settings.shortcuts.help.toggleFocusMode",
  "cycle-theme": "settings.shortcuts.help.cycleTheme",
  "focus-message-input": "settings.shortcuts.help.focusMessageInput",
  "cycle-agent-mode": "settings.shortcuts.help.cycleAgentMode",
  "voice-toggle": "settings.shortcuts.help.toggleVoiceMode",
  "dictation-toggle": "settings.shortcuts.help.startStopDictation",
  "agent-interrupt": "settings.shortcuts.help.interruptAgent",
  "voice-mute-toggle": "settings.shortcuts.help.muteUnmuteVoiceMode",
  "chat-find": "Find in chat",
  "editor-save": "settings.shortcuts.help.editorSave",
  "editor-find": "settings.shortcuts.help.editorFind",
  "editor-go-to-line": "settings.shortcuts.help.editorGoToLine",
  "editor-go-to-definition": "settings.shortcuts.help.editorGoToDefinition",
  "editor-find-references": "settings.shortcuts.help.editorFindReferences",
  "editor-rename-symbol": "settings.shortcuts.help.editorRenameSymbol",
  "markdown-bold": "settings.shortcuts.help.markdownBold",
  "markdown-italic": "settings.shortcuts.help.markdownItalic",
  "markdown-code": "settings.shortcuts.help.markdownCode",
  "markdown-strikethrough": "settings.shortcuts.help.markdownStrikethrough",
  "markdown-link": "settings.shortcuts.help.markdownLink",
  "markdown-bullet-list": "settings.shortcuts.help.markdownBulletList",
  "markdown-ordered-list": "settings.shortcuts.help.markdownOrderedList",
  "markdown-task-list": "settings.shortcuts.help.markdownTaskList",
  "markdown-toggle-task": "settings.shortcuts.help.markdownToggleTask",
  "markdown-blockquote": "settings.shortcuts.help.markdownBlockquote",
};

const SHORTCUT_HELP_NOTE_KEYS: Record<string, string> = {
  "show-shortcuts": "settings.shortcuts.helpNotes.showKeyboardShortcuts",
};

// --- Binding definitions ---

const SHORTCUT_BINDINGS: readonly ShortcutBinding[] = [
  // --- Open project ---
  // Open project moved from Cmd+Shift+O to Cmd+O. The binding ids intentionally
  // keep their original "cmd-shift-o" / "ctrl-shift-o" names: user shortcut
  // overrides are keyed by binding id, so renaming them would silently drop a
  // user's customized Open project shortcut on upgrade.
  {
    id: "agent-new-cmd-shift-o-mac",
    action: "agent.new",
    combo: "Cmd+O",
    when: { mac: true },
    help: {
      id: "new-agent",
      section: "projects",
      label: "Open project",
      keys: ["mod", "O"],
    },
  },
  {
    id: "agent-new-ctrl-shift-o-non-mac",
    action: "agent.new",
    combo: "Ctrl+O",
    when: { mac: false, terminal: false },
    help: {
      id: "new-agent",
      section: "projects",
      label: "Open project",
      keys: ["mod", "O"],
    },
  },

  // --- New workspace ---
  {
    id: "workspace-new-cmd-n-mac",
    action: "workspace.new",
    combo: "Cmd+N",
    when: { mac: true, commandCenter: false },
    help: {
      id: "new-workspace",
      section: "projects",
      label: "New workspace",
      keys: ["mod", "N"],
    },
  },
  {
    id: "workspace-new-ctrl-n-non-mac",
    action: "workspace.new",
    combo: "Ctrl+N",
    when: { mac: false, commandCenter: false, terminal: false },
    help: {
      id: "new-workspace",
      section: "projects",
      label: "New workspace",
      keys: ["mod", "N"],
    },
  },

  // --- Switch project (New Workspace screen) ---
  {
    id: "workspace-project-pick-cmd-p-mac",
    action: "workspace.project.pick",
    combo: "Cmd+P",
    when: { mac: true, commandCenter: false },
    help: {
      id: "switch-project",
      section: "projects",
      label: "Switch project",
      keys: ["mod", "P"],
    },
  },
  {
    id: "workspace-project-pick-ctrl-p-non-mac",
    action: "workspace.project.pick",
    combo: "Ctrl+P",
    when: { mac: false, commandCenter: false, terminal: false },
    help: {
      id: "switch-project",
      section: "projects",
      label: "Switch project",
      keys: ["mod", "P"],
    },
  },

  // --- Archive workspace ---
  {
    // COMPAT(workspaceArchiveShortcutOverride): added in v0.1.106; remove after
    // 2027-01-11 with a stored-override migration. Keeps existing custom chords.
    id: "worktree-archive-cmd-shift-backspace-mac",
    action: "workspace.archive",
    combo: "Cmd+Shift+Backspace",
    when: { mac: true, commandCenter: false },
    help: {
      id: "archive-workspace",
      section: "projects",
      label: "Archive workspace",
      keys: ["mod", "shift", "Backspace"],
    },
  },
  {
    // COMPAT(workspaceArchiveShortcutOverride): added in v0.1.106; remove after
    // 2027-01-11 with a stored-override migration. Keeps existing custom chords.
    id: "worktree-archive-ctrl-shift-backspace-non-mac",
    action: "workspace.archive",
    combo: "Ctrl+Shift+Backspace",
    when: { mac: false, commandCenter: false, terminal: false },
    help: {
      id: "archive-workspace",
      section: "projects",
      label: "Archive workspace",
      keys: ["mod", "shift", "Backspace"],
    },
  },

  // --- Pin workspace ---
  {
    id: "workspace-pin-cmd-shift-p-mac",
    action: "workspace.pin",
    combo: "Cmd+Shift+P",
    when: { mac: true, commandCenter: false },
    help: {
      id: "pin-workspace",
      section: "projects",
      label: "Pin chat",
      keys: ["mod", "shift", "P"],
    },
  },
  {
    id: "workspace-pin-ctrl-shift-p-non-mac",
    action: "workspace.pin",
    combo: "Ctrl+Shift+P",
    when: { mac: false, commandCenter: false, terminal: false },
    help: {
      id: "pin-workspace",
      section: "projects",
      label: "Pin chat",
      keys: ["mod", "shift", "P"],
    },
  },

  // --- Tab management ---
  {
    id: "workspace-tab-new-cmd-t-mac",
    action: "workspace.tab.new",
    combo: "Cmd+T",
    when: { mac: true, commandCenter: false },
    help: {
      id: "workspace-tab-new",
      section: "tabs-panes",
      label: "New tab",
      keys: ["mod", "T"],
    },
  },
  {
    id: "workspace-tab-new-ctrl-t-non-mac",
    action: "workspace.tab.new",
    combo: "Ctrl+T",
    when: { mac: false, commandCenter: false, terminal: false },
    help: {
      id: "workspace-tab-new",
      section: "tabs-panes",
      label: "New tab",
      keys: ["mod", "T"],
    },
  },
  {
    id: "workspace-tab-close-current-cmd-w-mac",
    action: "workspace.tab.close.current",
    combo: "Cmd+W",
    when: { mac: true, desktop: true, commandCenter: false },
    help: {
      id: "workspace-tab-close-current",
      section: "tabs-panes",
      label: "Close current tab",
      keys: ["meta", "W"],
      defaultDisplayKeys: ["meta", "W"],
    },
  },
  {
    id: "workspace-tab-close-current-ctrl-w-non-mac",
    action: "workspace.tab.close.current",
    combo: "Ctrl+W",
    when: { mac: false, desktop: true, commandCenter: false, terminal: false },
    help: {
      id: "workspace-tab-close-current",
      section: "tabs-panes",
      label: "Close current tab",
      keys: ["ctrl", "W"],
    },
  },
  {
    id: "workspace-tab-close-current-alt-shift-w-web",
    action: "workspace.tab.close.current",
    combo: "Alt+Shift+W",
    when: { desktop: false, commandCenter: false },
    help: {
      id: "workspace-tab-close-current",
      section: "tabs-panes",
      label: "Close current tab",
      keys: ["alt", "shift", "W"],
    },
  },

  // --- Workspace index jump ---
  {
    id: "workspace-navigate-index-cmd-digit-mac",
    action: "workspace.navigate.index",
    combo: "Cmd+Digit",
    when: { mac: true, desktop: true, commandCenter: false },
    payload: { type: "index" },
    help: {
      id: "workspace-jump-index",
      section: "navigation",
      label: "Jump to workspace",
      keys: ["mod", "1-9"],
      defaultDisplayKeys: ["mod", "1-9"],
    },
  },
  {
    id: "workspace-navigate-index-ctrl-digit-non-mac",
    action: "workspace.navigate.index",
    combo: "Ctrl+Digit",
    when: { mac: false, desktop: true, commandCenter: false, terminal: false },
    payload: { type: "index" },
    help: {
      id: "workspace-jump-index",
      section: "navigation",
      label: "Jump to workspace",
      keys: ["mod", "1-9"],
      defaultDisplayKeys: ["mod", "1-9"],
    },
  },
  {
    id: "workspace-navigate-index-alt-digit-web",
    action: "workspace.navigate.index",
    combo: "Alt+Digit",
    when: { desktop: false, commandCenter: false },
    payload: { type: "index" },
    help: {
      id: "workspace-jump-index",
      section: "navigation",
      label: "Jump to workspace",
      keys: ["alt", "1-9"],
      defaultDisplayKeys: ["alt", "1-9"],
    },
  },

  // --- Tab index jump ---
  {
    id: "workspace-tab-navigate-index-cmd-alt-digit-mac-desktop",
    action: "workspace.tab.navigate.index",
    combo: "Cmd+Alt+Digit",
    when: { mac: true, desktop: true, commandCenter: false },
    payload: { type: "index" },
    help: {
      id: "workspace-tab-jump-index",
      section: "navigation",
      label: "Jump to tab",
      keys: ["mod", "alt", "1-9"],
      defaultDisplayKeys: ["mod", "alt", "1-9"],
    },
  },
  {
    id: "workspace-tab-navigate-index-alt-digit-desktop",
    action: "workspace.tab.navigate.index",
    combo: "Alt+Digit",
    when: { mac: false, desktop: true, commandCenter: false },
    payload: { type: "index" },
    help: {
      id: "workspace-tab-jump-index",
      section: "navigation",
      label: "Jump to tab",
      keys: ["alt", "1-9"],
      defaultDisplayKeys: ["alt", "1-9"],
    },
  },
  {
    id: "workspace-tab-navigate-index-alt-shift-digit-web",
    action: "workspace.tab.navigate.index",
    combo: "Alt+Shift+Digit",
    when: { desktop: false, commandCenter: false },
    payload: { type: "index" },
    help: {
      id: "workspace-tab-jump-index",
      section: "navigation",
      label: "Jump to tab",
      keys: ["alt", "shift", "1-9"],
      defaultDisplayKeys: ["alt", "shift", "1-9"],
    },
  },

  // --- Workspace relative navigation ---
  {
    id: "workspace-navigate-relative-cmd-left-mac",
    action: "workspace.navigate.relative",
    combo: "Cmd+[",
    when: { mac: true, desktop: true, commandCenter: false },
    payload: { type: "delta", delta: -1 },
    help: {
      id: "workspace-prev",
      section: "navigation",
      label: "Previous workspace",
      keys: ["mod", "["],
    },
  },
  {
    id: "workspace-navigate-relative-ctrl-left-non-mac",
    action: "workspace.navigate.relative",
    combo: "Ctrl+[",
    when: { mac: false, desktop: true, commandCenter: false, terminal: false },
    payload: { type: "delta", delta: -1 },
    help: {
      id: "workspace-prev",
      section: "navigation",
      label: "Previous workspace",
      keys: ["mod", "["],
    },
  },
  {
    id: "workspace-navigate-relative-cmd-right-mac",
    action: "workspace.navigate.relative",
    combo: "Cmd+]",
    when: { mac: true, desktop: true, commandCenter: false },
    payload: { type: "delta", delta: 1 },
    help: {
      id: "workspace-next",
      section: "navigation",
      label: "Next workspace",
      keys: ["mod", "]"],
    },
  },
  {
    id: "workspace-navigate-relative-ctrl-right-non-mac",
    action: "workspace.navigate.relative",
    combo: "Ctrl+]",
    when: { mac: false, desktop: true, commandCenter: false, terminal: false },
    payload: { type: "delta", delta: 1 },
    help: {
      id: "workspace-next",
      section: "navigation",
      label: "Next workspace",
      keys: ["mod", "]"],
    },
  },
  {
    id: "workspace-navigate-relative-alt-left-web",
    action: "workspace.navigate.relative",
    combo: "Alt+[",
    when: { desktop: false, commandCenter: false },
    payload: { type: "delta", delta: -1 },
    help: {
      id: "workspace-prev",
      section: "navigation",
      label: "Previous workspace",
      keys: ["alt", "["],
    },
  },
  {
    id: "workspace-navigate-relative-alt-right-web",
    action: "workspace.navigate.relative",
    combo: "Alt+]",
    when: { desktop: false, commandCenter: false },
    payload: { type: "delta", delta: 1 },
    help: {
      id: "workspace-next",
      section: "navigation",
      label: "Next workspace",
      keys: ["alt", "]"],
    },
  },

  // --- Tab relative navigation ---
  {
    id: "workspace-tab-navigate-relative-alt-shift-left",
    action: "workspace.tab.navigate.relative",
    combo: "Alt+Shift+[",
    when: { commandCenter: false },
    payload: { type: "delta", delta: -1 },
    help: {
      id: "workspace-tab-prev",
      section: "navigation",
      label: "Previous tab",
      keys: ["alt", "shift", "["],
    },
  },
  {
    id: "workspace-tab-navigate-relative-alt-shift-right",
    action: "workspace.tab.navigate.relative",
    combo: "Alt+Shift+]",
    when: { commandCenter: false },
    payload: { type: "delta", delta: 1 },
    help: {
      id: "workspace-tab-next",
      section: "navigation",
      label: "Next tab",
      keys: ["alt", "shift", "]"],
    },
  },

  // --- Pane management ---
  {
    id: "workspace-pane-split-right-cmd-backslash",
    action: "workspace.pane.split.right",
    combo: "Cmd+\\",
    when: { mac: true, commandCenter: false },
    help: {
      id: "workspace-pane-split-right",
      section: "tabs-panes",
      label: "Split pane right",
      keys: ["mod", "\\"],
      defaultDisplayKeys: ["mod", "\\"],
    },
  },
  {
    id: "workspace-pane-split-down-cmd-shift-backslash",
    action: "workspace.pane.split.down",
    combo: "Cmd+Shift+\\",
    when: { mac: true, commandCenter: false },
    help: {
      id: "workspace-pane-split-down",
      section: "tabs-panes",
      label: "Split pane down",
      keys: ["mod", "shift", "\\"],
      defaultDisplayKeys: ["mod", "shift", "\\"],
    },
  },
  // Keep the same directional pair on Windows/Linux. Ctrl+\\ is unclaimed in
  // the effective registry, so these bindings do not displace an existing
  // desktop command.
  {
    id: "workspace-pane-split-right-ctrl-backslash",
    action: "workspace.pane.split.right",
    combo: "Ctrl+\\",
    when: { mac: false, commandCenter: false },
    help: {
      id: "workspace-pane-split-right",
      section: "tabs-panes",
      label: "Split pane right",
      keys: ["mod", "\\"],
      defaultDisplayKeys: ["mod", "\\"],
    },
  },
  {
    id: "workspace-pane-split-down-ctrl-shift-backslash",
    action: "workspace.pane.split.down",
    combo: "Ctrl+Shift+\\",
    when: { mac: false, commandCenter: false },
    help: {
      id: "workspace-pane-split-down",
      section: "tabs-panes",
      label: "Split pane down",
      keys: ["mod", "shift", "\\"],
      defaultDisplayKeys: ["mod", "shift", "\\"],
    },
  },
  {
    id: "workspace-pane-focus-left-cmd-shift-left",
    action: "workspace.pane.focus.left",
    combo: "Cmd+Shift+ArrowLeft",
    when: { mac: true, commandCenter: false, editable: false },
    help: {
      id: "workspace-pane-focus-left",
      section: "tabs-panes",
      label: "Focus pane left",
      keys: ["mod", "shift", "Left"],
    },
  },
  {
    id: "workspace-pane-focus-right-cmd-shift-right",
    action: "workspace.pane.focus.right",
    combo: "Cmd+Shift+ArrowRight",
    when: { mac: true, commandCenter: false, editable: false },
    help: {
      id: "workspace-pane-focus-right",
      section: "tabs-panes",
      label: "Focus pane right",
      keys: ["mod", "shift", "Right"],
    },
  },
  {
    id: "workspace-pane-focus-up-cmd-shift-up",
    action: "workspace.pane.focus.up",
    combo: "Cmd+Shift+ArrowUp",
    when: { mac: true, commandCenter: false, editable: false },
    help: {
      id: "workspace-pane-focus-up",
      section: "tabs-panes",
      label: "Focus pane up",
      keys: ["mod", "shift", "Up"],
    },
  },
  {
    id: "workspace-pane-focus-down-cmd-shift-down",
    action: "workspace.pane.focus.down",
    combo: "Cmd+Shift+ArrowDown",
    when: { mac: true, commandCenter: false, editable: false },
    help: {
      id: "workspace-pane-focus-down",
      section: "tabs-panes",
      label: "Focus pane down",
      keys: ["mod", "shift", "Down"],
    },
  },
  {
    id: "workspace-pane-move-tab-left-cmd-shift-alt-left",
    action: "workspace.pane.move-tab.left",
    combo: "Cmd+Alt+Shift+ArrowLeft",
    when: { mac: true, commandCenter: false },
    help: {
      id: "workspace-pane-move-tab-left",
      section: "tabs-panes",
      label: "Move tab left",
      keys: ["mod", "shift", "alt", "Left"],
    },
  },
  {
    id: "workspace-pane-move-tab-right-cmd-shift-alt-right",
    action: "workspace.pane.move-tab.right",
    combo: "Cmd+Alt+Shift+ArrowRight",
    when: { mac: true, commandCenter: false },
    help: {
      id: "workspace-pane-move-tab-right",
      section: "tabs-panes",
      label: "Move tab right",
      keys: ["mod", "shift", "alt", "Right"],
    },
  },
  {
    id: "workspace-pane-move-tab-up-cmd-shift-alt-up",
    action: "workspace.pane.move-tab.up",
    combo: "Cmd+Alt+Shift+ArrowUp",
    when: { mac: true, commandCenter: false },
    help: {
      id: "workspace-pane-move-tab-up",
      section: "tabs-panes",
      label: "Move tab up",
      keys: ["mod", "shift", "alt", "Up"],
    },
  },
  {
    id: "workspace-pane-move-tab-down-cmd-shift-alt-down",
    action: "workspace.pane.move-tab.down",
    combo: "Cmd+Alt+Shift+ArrowDown",
    when: { mac: true, commandCenter: false },
    help: {
      id: "workspace-pane-move-tab-down",
      section: "tabs-panes",
      label: "Move tab down",
      keys: ["mod", "shift", "alt", "Down"],
    },
  },
  {
    id: "workspace-pane-close-cmd-shift-w",
    action: "workspace.pane.close",
    combo: "Cmd+Shift+W",
    when: { mac: true, commandCenter: false },
    help: {
      id: "workspace-pane-close",
      section: "tabs-panes",
      label: "Close pane",
      keys: ["mod", "shift", "W"],
    },
  },

  // --- New terminal ---
  {
    id: "workspace-terminal-new-cmd-shift-t-mac",
    action: "workspace.terminal.new",
    combo: "Cmd+Shift+T",
    when: { mac: true, commandCenter: false },
    help: {
      id: "workspace-terminal-new",
      section: "panels",
      label: "New terminal",
      keys: ["mod", "shift", "T"],
    },
  },
  {
    id: "workspace-terminal-new-ctrl-shift-t-non-mac",
    action: "workspace.terminal.new",
    combo: "Ctrl+Shift+T",
    when: { mac: false, commandCenter: false, terminal: false },
    help: {
      id: "workspace-terminal-new",
      section: "panels",
      label: "New terminal",
      keys: ["mod", "shift", "T"],
    },
  },

  // --- Command center ---
  {
    id: "command-center-toggle-cmd-k-mac",
    action: "command-center.toggle",
    combo: "Cmd+K",
    when: { mac: true },
    help: {
      id: "toggle-command-center",
      section: "panels",
      label: "Toggle command center",
      keys: ["mod", "K"],
    },
  },
  {
    id: "command-center-toggle-ctrl-k-non-mac",
    action: "command-center.toggle",
    combo: "Ctrl+K",
    when: { mac: false, terminal: false },
    help: {
      id: "toggle-command-center",
      section: "panels",
      label: "Toggle command center",
      keys: ["mod", "K"],
    },
  },

  // --- Keyboard shortcuts dialog ---
  {
    id: "shortcuts-dialog-toggle-question-mark",
    action: "shortcuts.dialog.toggle",
    combo: "Shift+?",
    repeat: false,
    when: { focusScope: "other" },
    help: {
      id: "show-shortcuts",
      section: "panels",
      label: "Show keyboard shortcuts",
      keys: ["?"],
      note: "Available when focus is not in a text field or terminal.",
    },
  },

  // --- Sidebar toggles ---
  // Mod+B overlaps the file editor's Go to Definition and carries NO guard for
  // it: `editor.goToDefinition` in the File Editor section below is bound to the
  // same combo with `focusScope: "code-editor"`, and a focus-scoped binding
  // outranks an unscoped one, so the editor wins the combo while it has focus
  // and the toggle wins everywhere else - composer included. That is the whole
  // override mechanic, and it follows the editor binding: rebind Go to
  // definition off Mod+B and this toggle simply starts working in the editor
  // too, which a hardcoded guard could never do.
  {
    id: "sidebar-toggle-left-mac-cmd-b",
    action: "sidebar.toggle.left",
    combo: "Cmd+B",
    when: { mac: true },
    help: {
      id: "toggle-left-sidebar",
      section: "panels",
      label: "Toggle left sidebar",
      keys: ["mod", "B"],
    },
  },
  {
    // The id keeps its original "ctrl-period" name so existing user overrides,
    // which are keyed by id, survive; the binding itself is Ctrl+B.
    id: "sidebar-toggle-left-ctrl-period-non-mac",
    action: "sidebar.toggle.left",
    combo: "Ctrl+B",
    when: { mac: false, commandCenter: false, terminal: false },
    help: {
      id: "toggle-left-sidebar",
      section: "panels",
      label: "Toggle left sidebar",
      keys: ["mod", "B"],
      defaultDisplayKeys: ["mod", "B"],
    },
  },
  {
    id: "sidebar-toggle-right-cmd-e-mac",
    action: "sidebar.toggle.right",
    combo: "Cmd+E",
    when: { mac: true, commandCenter: false },
    help: {
      id: "toggle-right-sidebar",
      section: "panels",
      label: "Toggle right sidebar",
      keys: ["mod", "E"],
    },
  },
  {
    id: "sidebar-toggle-right-ctrl-e-non-mac",
    action: "sidebar.toggle.right",
    combo: "Ctrl+E",
    when: { mac: false, commandCenter: false, terminal: false },
    help: {
      id: "toggle-right-sidebar",
      section: "panels",
      label: "Toggle right sidebar",
      keys: ["mod", "E"],
    },
  },
  {
    id: "sidebar-toggle-right-ctrl-backquote",
    action: "sidebar.toggle.right",
    combo: "Ctrl+`",
    when: { commandCenter: false },
  },

  // --- Find a file (Files tab + its filename finder) ---
  // The four "find" gestures, kept straight because they are easy to conflate:
  //   Mod+,         - find A FILE by name, anywhere (this pair, the documented one)
  //   Mod+F         - find in this file (`editor.find`, File Editor section)
  //   Mod+F         - find A FILE by name, everywhere else (the alias pair below)
  //   Mod+Shift+F   - find in project, i.e. text across every file (below)
  // Mod+, is the row we print because it is the only one that survives a focused
  // text surface. In the editor `editor.find` outranks this pair on specificity,
  // which is what lets the two Mod+F meanings share a combo; the editable:false
  // below is doing the REST of the job - keeping Mod+F out of the composer and
  // plain text fields, where there is no editor binding to yield to and the
  // browser's own find is what the user means.
  // General rule: an Otto shortcut that overlaps an editor shortcut needs no
  // guard at all - put the editor's version in the File Editor section and it
  // takes over while the editor has focus. Reach for editable:false only for
  // scopes with no editor binding to hand the combo to.
  {
    id: "sidebar-open-files-cmd-comma-mac",
    action: "sidebar.open.files",
    combo: "Cmd+,",
    when: { mac: true, commandCenter: false },
    help: {
      id: "open-files-sidebar",
      section: "panels",
      label: "Find file in project",
      keys: ["mod", ","],
    },
  },
  {
    id: "sidebar-open-files-ctrl-comma-non-mac",
    action: "sidebar.open.files",
    combo: "Ctrl+,",
    when: { mac: false, commandCenter: false, terminal: false },
    help: {
      id: "open-files-sidebar",
      section: "panels",
      label: "Find file in project",
      keys: ["mod", ","],
    },
  },
  // --- Find in project ---
  // Mod+S is deliberately NOT bound here. It used to open this same sidebar,
  // which made it a duplicate of Mod+Shift+F while shadowing the one thing
  // Mod+S means to everyone - Save. It stays free.
  {
    id: "sidebar-open-search-cmd-shift-f-mac",
    action: "sidebar.open.search",
    combo: "Cmd+Shift+F",
    when: { mac: true, commandCenter: false },
    help: {
      id: "find-in-files",
      section: "panels",
      label: "Find in project",
      keys: ["mod", "shift", "F"],
    },
  },
  {
    id: "sidebar-open-search-ctrl-shift-f-non-mac",
    action: "sidebar.open.search",
    combo: "Ctrl+Shift+F",
    when: { mac: false, commandCenter: false, terminal: false },
    help: {
      id: "find-in-files",
      section: "panels",
      label: "Find in project",
      keys: ["mod", "shift", "F"],
    },
  },

  // --- Open changes sidebar ---
  {
    id: "sidebar-open-changes-cmd-h-mac",
    action: "sidebar.open.changes",
    combo: "Cmd+H",
    when: { mac: true, commandCenter: false },
    help: {
      id: "open-changes-sidebar",
      section: "panels",
      label: "Open changes sidebar",
      keys: ["mod", "H"],
    },
  },
  {
    id: "sidebar-open-changes-ctrl-h-non-mac",
    action: "sidebar.open.changes",
    combo: "Ctrl+H",
    when: { mac: false, commandCenter: false, terminal: false },
    help: {
      id: "open-changes-sidebar",
      section: "panels",
      label: "Open changes sidebar",
      keys: ["mod", "H"],
    },
  },

  // --- Toggle both sidebars ---
  {
    id: "sidebar-toggle-both-cmd-period-mac",
    action: "sidebar.toggle.both",
    combo: "Cmd+.",
    when: { mac: true, commandCenter: false },
    help: {
      id: "toggle-both-sidebars",
      section: "panels",
      label: "Toggle both sidebars",
      keys: ["mod", "."],
    },
  },
  {
    id: "sidebar-toggle-both-ctrl-period-non-mac",
    action: "sidebar.toggle.both",
    combo: "Ctrl+.",
    when: { mac: false, commandCenter: false, terminal: false },
    help: {
      id: "toggle-both-sidebars",
      section: "panels",
      label: "Toggle both sidebars",
      keys: ["mod", "."],
      defaultDisplayKeys: ["mod", "."],
    },
  },

  // --- Settings toggle ---
  // Intentionally unbound. Mod+, used to open Settings, the way it does in most
  // apps; it now opens the file finder, which is what that combo is worth here.
  // The `settings.toggle` action and its route stay live for whatever combo
  // Settings lands on later, as do its `settings.shortcuts.help.toggleSettings`
  // strings.

  // --- Focus mode ---
  // Mod+Alt+F, not Mod+Shift+F: the latter is find-in-files everywhere
  // (VS Code, JetBrains), and reserving it for a view toggle meant the
  // editor's find family had no room to grow. Same shape as theme cycling,
  // which already lives on Mod+Alt.
  {
    id: "view-toggle-focus-cmd-alt-f-mac",
    action: "view.toggle.focus",
    combo: "Cmd+Alt+F",
    when: { mac: true, commandCenter: false },
    help: {
      id: "toggle-focus",
      section: "panels",
      label: "Toggle focus mode",
      keys: ["mod", "alt", "F"],
    },
  },
  {
    id: "view-toggle-focus-ctrl-alt-f-non-mac",
    action: "view.toggle.focus",
    combo: "Ctrl+Alt+F",
    when: { mac: false, commandCenter: false, terminal: false },
    help: {
      id: "toggle-focus",
      section: "panels",
      label: "Toggle focus mode",
      keys: ["mod", "alt", "F"],
    },
  },

  // --- Theme cycling ---
  {
    id: "theme-cycle-cmd-shift-t-mac",
    action: "theme.cycle",
    combo: "Cmd+Alt+T",
    when: { mac: true, commandCenter: false },
    help: {
      id: "cycle-theme",
      section: "panels",
      label: "Cycle theme",
      keys: ["mod", "alt", "T"],
    },
  },
  {
    id: "theme-cycle-ctrl-alt-t-non-mac",
    action: "theme.cycle",
    combo: "Ctrl+Alt+T",
    when: { mac: false, commandCenter: false, terminal: false },
    help: {
      id: "cycle-theme",
      section: "panels",
      label: "Cycle theme",
      keys: ["mod", "alt", "T"],
    },
  },

  // --- Message input ---
  {
    id: "chat-find-mod-f",
    action: "chat.find",
    combo: "Mod+F",
    when: { commandCenter: false, terminal: false },
    help: {
      id: "chat-find",
      section: "agent-input",
      label: "Find in chat",
      keys: ["mod", "F"],
    },
  },
  {
    id: "message-input-focus-cmd-l-mac",
    action: "message-input.action",
    combo: "Cmd+L",
    when: { mac: true, commandCenter: false },
    payload: { type: "message-input", kind: "focus" },
    help: {
      id: "focus-message-input",
      section: "agent-input",
      label: "Focus message input",
      keys: ["mod", "L"],
    },
  },
  {
    id: "message-input-focus-ctrl-l-non-mac",
    action: "message-input.action",
    combo: "Ctrl+L",
    when: { mac: false, commandCenter: false, terminal: false },
    payload: { type: "message-input", kind: "focus" },
    help: {
      id: "focus-message-input",
      section: "agent-input",
      label: "Focus message input",
      keys: ["mod", "L"],
    },
  },
  {
    id: "message-input-mode-cycle-shift-tab",
    action: "message-input.action",
    combo: "Shift+Tab",
    repeat: false,
    when: { commandCenter: false, focusScope: "message-input" },
    payload: { type: "message-input", kind: "mode-cycle" },
    help: {
      id: "cycle-agent-mode",
      section: "agent-input",
      label: "Cycle agent mode",
      keys: ["shift", "Tab"],
    },
  },
  {
    id: "message-input-voice-toggle-cmd-shift-d-mac",
    action: "message-input.action",
    combo: "Cmd+Shift+D",
    repeat: false,
    when: { mac: true, commandCenter: false, terminal: false },
    payload: { type: "message-input", kind: "voice-toggle" },
    help: {
      id: "voice-toggle",
      section: "agent-input",
      label: "Toggle voice mode",
      keys: ["mod", "shift", "D"],
    },
  },
  {
    id: "message-input-voice-toggle-ctrl-shift-d-non-mac",
    action: "message-input.action",
    combo: "Ctrl+Shift+D",
    repeat: false,
    when: { mac: false, commandCenter: false, terminal: false },
    payload: { type: "message-input", kind: "voice-toggle" },
    help: {
      id: "voice-toggle",
      section: "agent-input",
      label: "Toggle voice mode",
      keys: ["mod", "shift", "D"],
    },
  },
  {
    id: "message-input-dictation-toggle-cmd-d-mac",
    action: "message-input.action",
    combo: "Cmd+D",
    when: { mac: true, commandCenter: false, terminal: false },
    payload: { type: "message-input", kind: "dictation-toggle" },
    help: {
      id: "dictation-toggle",
      section: "agent-input",
      label: "Start/stop dictation",
      keys: ["mod", "D"],
    },
  },
  {
    id: "message-input-dictation-toggle-ctrl-d-non-mac",
    action: "message-input.action",
    combo: "Ctrl+D",
    when: { mac: false, commandCenter: false, terminal: false },
    payload: { type: "message-input", kind: "dictation-toggle" },
    help: {
      id: "dictation-toggle",
      section: "agent-input",
      label: "Start/stop dictation",
      keys: ["mod", "D"],
    },
  },
  {
    id: "agent-interrupt",
    action: "agent.interrupt",
    combo: "Escape",
    when: { commandCenter: false, terminal: false },
    preventDefault: false,
    stopPropagation: false,
    help: {
      id: "agent-interrupt",
      section: "agent-input",
      label: "Interrupt agent",
      keys: ["Esc"],
    },
  },
  {
    id: "message-input-dictation-confirm-enter",
    action: "message-input.action",
    combo: "Enter",
    when: { commandCenter: false, terminal: false },
    payload: { type: "message-input", kind: "dictation-confirm" },
  },

  {
    id: "message-input-voice-mute-toggle",
    action: "message-input.action",
    combo: "Space",
    repeat: false,
    when: { commandCenter: false, focusScope: "other" },
    payload: { type: "message-input", kind: "voice-mute-toggle" },
    help: {
      id: "voice-mute-toggle",
      section: "agent-input",
      label: "Mute/unmute voice mode",
      keys: ["Space"],
    },
  },

  // --- Markdown Editor ---
  // Declared BEFORE the File Editor section, and that order is load-bearing
  // twice over. `buildEditorKeyBindings` walks this array in order, so the CM6
  // keymap gets bold's `Mod-b` ahead of Go to definition's - and because the
  // markdown commands return false outside markdown context, the same keymap
  // runs bold in a `.md` file and falls through to Go to definition in a `.ts`
  // one without either binding knowing what file is open.
  //
  // The scope is `markdown-editor`, not `code-editor`, and that is the whole
  // reason the scope exists. These rows claim combos the app uses globally
  // (`Mod+K` is the command center, `Mod+B` toggles the left sidebar), and a
  // row scoped to `code-editor` would claim them in EVERY code file, where the
  // markdown command declines and the key would simply die. Scoped this way
  // they are taken only where they are meant.
  //
  // Inside a markdown file `Mod+K` is therefore a link rather than the command
  // center. That is the same deliberate trade the File Editor section already
  // makes with `Mod+B`, and it matches every other markdown editor.
  //
  // NOT here, on purpose: heading levels. Every conventional combo for them
  // (`Mod+1`, `Alt+1`, `Mod+Alt+1`) is already a workspace or tab jump, and
  // taking navigation away inside one file type costs more than a heading
  // shortcut is worth. Headings live on the formatting toolbar, where the
  // command surface reaches them without a key.
  {
    id: "markdown-bold-mod-b",
    action: "editor.markdown.bold",
    combo: "Mod+B",
    when: { focusScope: "markdown-editor" },
    help: {
      id: "markdown-bold",
      section: "markdown-editor",
      label: "Bold",
      keys: ["mod", "B"],
    },
  },
  {
    id: "markdown-italic-mod-i",
    action: "editor.markdown.italic",
    combo: "Mod+I",
    when: { focusScope: "markdown-editor" },
    help: {
      id: "markdown-italic",
      section: "markdown-editor",
      label: "Italic",
      keys: ["mod", "I"],
    },
  },
  {
    id: "markdown-code-mod-shift-c",
    action: "editor.markdown.code",
    combo: "Mod+Shift+C",
    when: { focusScope: "markdown-editor" },
    help: {
      id: "markdown-code",
      section: "markdown-editor",
      label: "Inline code",
      keys: ["mod", "shift", "C"],
    },
  },
  {
    id: "markdown-strikethrough-mod-shift-x",
    action: "editor.markdown.strikethrough",
    combo: "Mod+Shift+X",
    when: { focusScope: "markdown-editor" },
    help: {
      id: "markdown-strikethrough",
      section: "markdown-editor",
      label: "Strikethrough",
      keys: ["mod", "shift", "X"],
    },
  },
  {
    id: "markdown-link-mod-k",
    action: "editor.markdown.link",
    combo: "Mod+K",
    when: { focusScope: "markdown-editor" },
    help: {
      id: "markdown-link",
      section: "markdown-editor",
      label: "Insert link",
      keys: ["mod", "K"],
    },
  },
  {
    id: "markdown-bullet-list-mod-shift-u",
    action: "editor.markdown.bulletList",
    combo: "Mod+Shift+U",
    when: { focusScope: "markdown-editor" },
    help: {
      id: "markdown-bullet-list",
      section: "markdown-editor",
      label: "Bullet list",
      keys: ["mod", "shift", "U"],
    },
  },
  {
    id: "markdown-ordered-list-mod-shift-o",
    action: "editor.markdown.orderedList",
    combo: "Mod+Shift+O",
    when: { focusScope: "markdown-editor" },
    help: {
      id: "markdown-ordered-list",
      section: "markdown-editor",
      label: "Numbered list",
      keys: ["mod", "shift", "O"],
    },
  },
  {
    id: "markdown-task-list-mod-shift-l",
    action: "editor.markdown.taskList",
    combo: "Mod+Shift+L",
    when: { focusScope: "markdown-editor" },
    help: {
      id: "markdown-task-list",
      section: "markdown-editor",
      label: "Task list",
      keys: ["mod", "shift", "L"],
    },
  },
  {
    id: "markdown-toggle-task-mod-enter",
    action: "editor.markdown.toggleTask",
    combo: "Mod+Enter",
    when: { focusScope: "markdown-editor" },
    help: {
      id: "markdown-toggle-task",
      section: "markdown-editor",
      label: "Check/uncheck task",
      keys: ["mod", "Enter"],
    },
  },
  {
    id: "markdown-blockquote-mod-shift-q",
    action: "editor.markdown.blockquote",
    combo: "Mod+Shift+Q",
    when: { focusScope: "markdown-editor" },
    help: {
      id: "markdown-blockquote",
      section: "markdown-editor",
      label: "Blockquote",
      keys: ["mod", "shift", "Q"],
    },
  },

  // --- File Editor ---
  // The only bindings here that carry `focusScope: "code-editor"`, and the only
  // ones the app does not dispatch. Three things follow from that, and all three
  // are the point of the section:
  //
  //  1. OVERRIDE. A focus-scoped binding outranks an unscoped one on the same
  //     combo (see `bindingSpecificity`), so while the editor has focus these
  //     win - and the general binding they shadow needs no guard of its own.
  //     Outside the editor they never match, so nothing is taken away.
  //  2. EXECUTION. `routeKeyboardShortcut` deliberately routes `editor.*`
  //     nowhere; CodeMirror runs the command, from a keymap built out of these
  //     bindings (editor/editor-key-bindings.ts). Matching here and doing
  //     nothing is exactly what makes the shadowed general action stand down.
  //  3. CUSTOMIZATION. Being registry bindings they are listed and rebindable in
  //     Settings like every other row, and a rebind flows into the CM6 keymap.
  //
  // Written as single `Mod+` bindings rather than the Cmd/Ctrl pairs above: the
  // focus scope already excludes the terminal, so there is no per-platform guard
  // to split them over, and one binding means one rebindable row.
  //
  // NOT here, on purpose: Escape-closes-find (conditional on a query running, so
  // it has to fall through to CM6's simplifySelection when idle - a condition the
  // registry cannot express) and CodeMirror's `defaultKeymap` (select line,
  // undo, indent…), which are the platform's editor bindings rather than Otto's.
  {
    id: "editor-save-mod-s",
    action: "editor.save",
    combo: "Mod+S",
    when: { focusScope: "code-editor" },
    help: {
      id: "editor-save",
      section: "editor",
      label: "Save file",
      keys: ["mod", "S"],
    },
  },
  {
    id: "editor-find-mod-f",
    action: "editor.find",
    combo: "Mod+F",
    when: { focusScope: "code-editor" },
    help: {
      id: "editor-find",
      section: "editor",
      label: "Find in file",
      keys: ["mod", "F"],
    },
  },
  {
    id: "editor-go-to-line-mod-g",
    action: "editor.goToLine",
    combo: "Mod+G",
    when: { focusScope: "code-editor" },
    help: {
      id: "editor-go-to-line",
      section: "editor",
      label: "Go to line",
      keys: ["mod", "G"],
    },
  },
  {
    id: "editor-go-to-definition-mod-b",
    action: "editor.goToDefinition",
    combo: "Mod+B",
    when: { focusScope: "code-editor" },
    help: {
      id: "editor-go-to-definition",
      section: "editor",
      label: "Go to definition",
      keys: ["mod", "B"],
    },
  },
  // F12 stays as an alias with no help row - muscle memory splits (Mod+B is
  // JetBrains, F12 is VS Code) but one feature gets one row, and that row has to
  // be the combo that survives a laptop with media keys on the function row.
  // Same shape as Ctrl+` aliasing the right sidebar.
  {
    id: "editor-go-to-definition-f12",
    action: "editor.goToDefinition",
    combo: "F12",
    when: { focusScope: "code-editor" },
  },
  {
    id: "editor-find-references-shift-f12",
    action: "editor.findReferences",
    combo: "Shift+F12",
    when: { focusScope: "code-editor" },
    help: {
      id: "editor-find-references",
      section: "editor",
      label: "Find references",
      keys: ["shift", "F12"],
    },
  },
  {
    id: "editor-rename-symbol-f2",
    action: "editor.renameSymbol",
    combo: "F2",
    when: { focusScope: "code-editor" },
    help: {
      id: "editor-rename-symbol",
      section: "editor",
      label: "Rename symbol",
      keys: ["F2"],
    },
  },
];

// --- Parse bindings at module load ---

export const UNASSIGNED_COMBO = null;

export function parseBindingChord(combo: string): KeyCombo[] {
  return combo === "" ? [] : parseChordString(combo);
}

function parseBinding(binding: ShortcutBinding): ParsedShortcutBinding {
  const parsedChord = parseBindingChord(binding.combo);
  const lastCombo = parsedChord.at(-1);
  if (binding.repeat === false && lastCombo) {
    lastCombo.repeat = false;
  }
  return { ...binding, parsedChord };
}

export const DEFAULT_BINDINGS: readonly ParsedShortcutBinding[] =
  SHORTCUT_BINDINGS.map(parseBinding);

export type ShortcutOverrides = Record<string, string | null>;

export function buildEffectiveBindings(overrides: ShortcutOverrides): ParsedShortcutBinding[] {
  return DEFAULT_BINDINGS.map(function (binding) {
    const override = overrides[binding.id];
    if (override === UNASSIGNED_COMBO) {
      return { ...binding, combo: "", parsedChord: [] };
    }
    if (typeof override !== "string") {
      return binding;
    }
    let parsedChord: KeyCombo[];
    try {
      parsedChord = parseBindingChord(override);
    } catch {
      return binding;
    }
    const lastCombo = parsedChord.at(-1);
    if (binding.repeat === false && lastCombo) {
      lastCombo.repeat = false;
    }
    if (!binding.help?.defaultDisplayKeys) {
      return { ...binding, combo: override, parsedChord };
    }
    const { defaultDisplayKeys: _defaultDisplayKeys, ...help } = binding.help;
    return { ...binding, combo: override, parsedChord, help };
  });
}

// --- Matching engine ---

function parseDigit(event: KeyboardShortcutInput): number | null {
  const code = event.code;
  if (code.startsWith("Digit")) {
    const value = Number(code.slice("Digit".length));
    return Number.isFinite(value) && value >= 1 && value <= 9 ? value : null;
  }
  if (code.startsWith("Numpad")) {
    const value = Number(code.slice("Numpad".length));
    return Number.isFinite(value) && value >= 1 && value <= 9 ? value : null;
  }
  const key = event.key;
  if (key >= "1" && key <= "9") {
    return Number(key);
  }
  return null;
}

function matchesKeyOrCode(combo: KeyCombo, event: KeyboardShortcutInput): boolean {
  if (combo.key === undefined) {
    return event.code === combo.code;
  }
  const eventKey = event.key.toLowerCase();
  if (eventKey === combo.key) return true;
  if (combo.shift === true && combo.shiftedKey !== undefined && eventKey === combo.shiftedKey) {
    return true;
  }
  // macOS rewrites event.key when Option is held (Option+T -> "†",
  // Option+[ -> "“"), so Alt-bound letter / bracket bindings can only
  // match by event.code. Stay key-first for non-Alt bindings so Dvorak
  // keeps its logical-character matching (e.g. Cmd+V on physical Period
  // must paste, not trigger Cmd+.).
  if (combo.alt === true && event.code === combo.code) return true;
  return combo.codeFallback === true && event.code === combo.code;
}

function matchesCombo(combo: KeyCombo, event: KeyboardShortcutInput, isMac: boolean): boolean {
  if (combo.mod) {
    if (isMac) {
      if (!event.metaKey) return false;
      if (!!combo.ctrl !== event.ctrlKey) return false;
    } else {
      if (!event.ctrlKey) return false;
      if (!!combo.meta !== event.metaKey) return false;
    }
  } else {
    if (!!combo.meta !== event.metaKey) return false;
    if (!!combo.ctrl !== event.ctrlKey) return false;
  }
  if (!!combo.alt !== event.altKey) return false;
  if (!!combo.shift !== event.shiftKey) return false;
  if (combo.repeat === false && event.repeat) return false;

  if (combo.code === "Digit") {
    return parseDigit(event) !== null;
  }
  return matchesKeyOrCode(combo, event);
}

export function matchesKeyboardShortcutContext(
  when: ShortcutWhen | undefined,
  context: KeyboardShortcutContext,
): boolean {
  if (!when) return true;
  if (when.mac !== undefined && when.mac !== context.isMac) return false;
  if (when.desktop !== undefined && when.desktop !== context.isDesktop) return false;
  if (
    when.editable === false &&
    (context.focusScope === "message-input" ||
      context.focusScope === "editable" ||
      context.focusScope === "code-editor" ||
      context.focusScope === "markdown-editor")
  ) {
    return false;
  }
  if (when.terminal === false && context.focusScope === "terminal") return false;
  if (when.commandCenter === false && context.commandCenterOpen) return false;
  if (when.focusScope !== undefined && !focusScopeSatisfies(context.focusScope, when.focusScope)) {
    return false;
  }
  return true;
}

/**
 * The one place a focus scope is narrower than another.
 *
 * A markdown file is still a file: Save, Find and Go to line are declared once,
 * on `code-editor`, and must keep matching when the narrower scope is the one
 * actually focused. Without this every File Editor row would have to be
 * duplicated per scope, and the two copies would drift.
 */
const FOCUS_SCOPE_PARENT: Partial<Record<KeyboardFocusScope, KeyboardFocusScope>> = {
  "markdown-editor": "code-editor",
};

function focusScopeSatisfies(actual: KeyboardFocusScope, required: KeyboardFocusScope): boolean {
  return actual === required || FOCUS_SCOPE_PARENT[actual] === required;
}

/**
 * How specific a binding is to the CURRENT context, for picking a winner when
 * two of them claim the same combo. Only meaningful for a binding that has
 * already passed `matchesWhen`, so a declared `focusScope` has matched either
 * exactly or through the parent chain.
 *
 * Three ranks, because there are three ways to claim a combo:
 *   2 - names the focused surface exactly (Markdown Editor in a `.md` file)
 *   1 - names a scope the focused surface inherits from (File Editor there too)
 *   0 - applies everywhere
 *
 * This is what makes the File Editor section OVERRIDE the general bindings while
 * the editor has focus, and the Markdown Editor section override File Editor
 * inside a markdown file, without any binding having to opt out. Ties keep the
 * first match in `SHORTCUT_BINDINGS` order, so ordering still decides among
 * equally specific bindings.
 */
export function bindingSpecificity(
  binding: ParsedShortcutBinding,
  context: KeyboardShortcutContext,
): number {
  const scope = binding.when?.focusScope;
  if (scope === undefined) return 0;
  return scope === context.focusScope ? 2 : 1;
}

function resolvePayload(
  def: ShortcutPayloadDef | undefined,
  event: KeyboardShortcutInput,
): KeyboardShortcutPayload {
  if (!def) return null;
  switch (def.type) {
    case "index": {
      const index = parseDigit(event);
      return index ? { index } : null;
    }
    case "delta":
      return { delta: def.delta };
    case "message-input":
      return { kind: def.kind };
    default:
      throw new Error("unreachable");
  }
}

const CHORD_TIMEOUT_MS = 1500;

function clearChordTimeout(timeoutId: ReturnType<typeof setTimeout> | null): void {
  if (timeoutId !== null) {
    clearTimeout(timeoutId);
  }
}

function createChordTimeout(onChordReset: () => void): ReturnType<typeof setTimeout> {
  return setTimeout(onChordReset, CHORD_TIMEOUT_MS);
}

function resetChordState(input: ChordState): ChordState {
  clearChordTimeout(input.timeoutId);
  return {
    candidateIndices: [],
    step: 0,
    timeoutId: null,
  };
}

function helpMatchesPlatform(
  when: ShortcutWhen | undefined,
  context: KeyboardShortcutPlatformContext,
): boolean {
  if (when?.mac !== undefined && when.mac !== context.isMac) return false;
  if (when?.desktop !== undefined && when.desktop !== context.isDesktop) return false;
  return true;
}

// --- Public API ---

function buildMatchFromBinding(
  binding: ParsedShortcutBinding,
  event: KeyboardShortcutInput,
): KeyboardShortcutMatch {
  return {
    action: binding.action,
    payload: resolvePayload(binding.payload, event),
    preventDefault: binding.preventDefault ?? true,
    stopPropagation: binding.stopPropagation ?? true,
  };
}

function resolveInitialChordStep(input: {
  event: KeyboardShortcutInput;
  context: KeyboardShortcutContext;
  chordState: ChordState;
  onChordReset: () => void;
  bindings: readonly ParsedShortcutBinding[];
}): {
  match: KeyboardShortcutMatch | null;
  nextChordState: ChordState;
  preventDefault: boolean;
} {
  const { event, context, chordState, onChordReset, bindings } = input;
  const advancingCandidateIndices: number[] = [];
  let singleComboMatch: KeyboardShortcutMatch | null = null;
  let singleComboSpecificity = -1;

  for (const [index, binding] of bindings.entries()) {
    const firstCombo = binding.parsedChord[0];
    if (!firstCombo) {
      continue;
    }
    if (!matchesCombo(firstCombo, event, context.isMac)) {
      continue;
    }
    if (!matchesKeyboardShortcutContext(binding.when, context)) {
      continue;
    }
    if (binding.parsedChord.length > 1) {
      advancingCandidateIndices.push(index);
      continue;
    }
    // Strictly greater, so equally specific bindings keep first-match-wins.
    const specificity = bindingSpecificity(binding, context);
    if (specificity > singleComboSpecificity) {
      singleComboMatch = buildMatchFromBinding(binding, event);
      singleComboSpecificity = specificity;
    }
  }

  if (advancingCandidateIndices.length > 0) {
    return {
      match: null,
      nextChordState: {
        candidateIndices: advancingCandidateIndices,
        step: 1,
        timeoutId: createChordTimeout(onChordReset),
      },
      preventDefault: true,
    };
  }

  return {
    match: singleComboMatch,
    nextChordState: resetChordState(chordState),
    preventDefault: false,
  };
}

function resolveAdvancingChordStep(input: {
  event: KeyboardShortcutInput;
  context: KeyboardShortcutContext;
  chordState: ChordState;
  onChordReset: () => void;
  bindings: readonly ParsedShortcutBinding[];
}): {
  match: KeyboardShortcutMatch | null;
  nextChordState: ChordState;
  preventDefault: boolean;
} {
  const { event, context, chordState, onChordReset, bindings } = input;
  const matchingCandidateIndices: number[] = [];
  let completedMatch: KeyboardShortcutMatch | null = null;
  let completedSpecificity = -1;

  for (const index of chordState.candidateIndices) {
    const binding = bindings[index];
    if (!binding) {
      continue;
    }
    const combo = binding.parsedChord[chordState.step];
    if (!combo) {
      continue;
    }
    if (!matchesCombo(combo, event, context.isMac)) {
      continue;
    }
    if (!matchesKeyboardShortcutContext(binding.when, context)) {
      continue;
    }
    if (chordState.step + 1 === binding.parsedChord.length) {
      // No early exit: a later candidate may name the focused surface, and a
      // chord rebound onto the editor has to win the same way a single combo
      // does. The still-advancing candidates collected below are discarded
      // whenever a completion is returned, so scanning on costs nothing.
      const specificity = bindingSpecificity(binding, context);
      if (specificity > completedSpecificity) {
        completedMatch = buildMatchFromBinding(binding, event);
        completedSpecificity = specificity;
      }
      continue;
    }
    matchingCandidateIndices.push(index);
  }

  if (completedMatch) {
    return {
      match: completedMatch,
      nextChordState: resetChordState(chordState),
      preventDefault: false,
    };
  }

  if (matchingCandidateIndices.length > 0) {
    clearChordTimeout(chordState.timeoutId);
    return {
      match: null,
      nextChordState: {
        candidateIndices: matchingCandidateIndices,
        step: chordState.step + 1,
        timeoutId: createChordTimeout(onChordReset),
      },
      preventDefault: true,
    };
  }

  return {
    match: null,
    nextChordState: resetChordState(chordState),
    preventDefault: false,
  };
}

export function resolveKeyboardShortcut(input: {
  event: KeyboardShortcutInput;
  context: KeyboardShortcutContext;
  chordState: ChordState;
  onChordReset: () => void;
  bindings?: readonly ParsedShortcutBinding[];
}): {
  match: KeyboardShortcutMatch | null;
  nextChordState: ChordState;
  preventDefault: boolean;
} {
  const { event, context, chordState, onChordReset, bindings = DEFAULT_BINDINGS } = input;
  if (chordState.step === 0) {
    return resolveInitialChordStep({ event, context, chordState, onChordReset, bindings });
  }
  return resolveAdvancingChordStep({ event, context, chordState, onChordReset, bindings });
}

export function getBindingIdForAction(
  actionId: string,
  platform: { isMac: boolean; isDesktop: boolean },
): string | null {
  for (const binding of DEFAULT_BINDINGS) {
    if (binding.help?.id !== actionId) {
      continue;
    }
    if (!helpMatchesPlatform(binding.when, platform)) {
      continue;
    }
    return binding.id;
  }
  return null;
}

export function getDefaultKeysForAction(
  actionId: string,
  platform: { isMac: boolean; isDesktop: boolean },
  bindings: readonly ParsedShortcutBinding[] = DEFAULT_BINDINGS,
): ShortcutKey[][] | null {
  for (const binding of bindings) {
    if (binding.help?.id !== actionId) {
      continue;
    }
    if (!helpMatchesPlatform(binding.when, platform)) {
      continue;
    }
    return displayChordForBinding(binding);
  }
  return null;
}

function displayChordForBinding(binding: ParsedShortcutBinding): ShortcutKey[][] | null {
  if (binding.parsedChord.length === 0) return null;
  const displayKeys = binding.help?.defaultDisplayKeys;
  return displayKeys ? [displayKeys] : chordStringToShortcutKeys(binding.combo);
}

export function resolveShortcutKeysForAction(
  actionId: string,
  overrides: ShortcutOverrides,
  platform: { isMac: boolean; isDesktop: boolean },
): ShortcutKey[][] | null {
  const bindingId = getBindingIdForAction(actionId, platform);
  if (bindingId === null) return null;
  const defaultChord = getDefaultKeysForAction(actionId, platform);
  const override = overrides[bindingId];
  if (override === UNASSIGNED_COMBO || override === "") return null;
  if (typeof override !== "string") return defaultChord;
  try {
    parseBindingChord(override);
    return chordStringToShortcutKeys(override);
  } catch {
    return defaultChord;
  }
}

/**
 * The `KeyboardEvent.key` whose hold reveals the sidebar workspace-jump number
 * badges. It must match the modifier of the active `workspace.navigate.index`
 * binding for this runtime, otherwise the badges appear for a modifier that
 * does not actually jump: Alt on web, Cmd (Meta) on desktop Mac, Ctrl on
 * desktop non-Mac.
 */
export function getWorkspaceIndexJumpModifierKey(
  platform: { isMac: boolean; isDesktop: boolean },
  bindings: readonly ParsedShortcutBinding[] = DEFAULT_BINDINGS,
): "Alt" | "Meta" | "Control" | null {
  const binding = bindings.find(
    (candidate) =>
      candidate.action === "workspace.navigate.index" &&
      helpMatchesPlatform(candidate.when, platform),
  );
  if (!binding || binding.parsedChord.length !== 1) return null;
  const combo = binding.parsedChord[0];
  if (!combo || combo.code !== "Digit") return null;
  const modifiers = [combo.mod, combo.meta, combo.ctrl, combo.alt, combo.shift];
  if (modifiers.filter(Boolean).length !== 1) return null;
  if (combo.mod) return platform.isMac ? "Meta" : "Control";
  if (combo.meta) return "Meta";
  if (combo.ctrl) return "Control";
  if (combo.alt) return "Alt";
  return null;
}

export function buildKeyboardShortcutHelpSections(
  input: KeyboardShortcutPlatformContext,
  bindings: readonly ParsedShortcutBinding[] = DEFAULT_BINDINGS,
): KeyboardShortcutHelpSection[] {
  const seenRows = new Set<string>();
  const rowsBySection = new Map<ShortcutSectionId, KeyboardShortcutHelpRow[]>([
    ["navigation", []],
    ["tabs-panes", []],
    ["projects", []],
    ["panels", []],
    ["layout", []],
    ["editor", []],
    ["markdown-editor", []],
    ["agent-input", []],
  ]);

  for (const binding of bindings) {
    const help = binding.help;
    if (!help) {
      continue;
    }
    if (!helpMatchesPlatform(binding.when, input)) {
      continue;
    }
    const outputSection = help.section === "panels" ? "layout" : help.section;
    const rowKey = `${outputSection}:${help.id}`;
    if (seenRows.has(rowKey)) {
      continue;
    }
    seenRows.add(rowKey);

    const rows = rowsBySection.get(outputSection);
    if (!rows) {
      continue;
    }
    const chord = displayChordForBinding(binding);
    rows.push({
      id: help.id,
      label: help.label,
      labelKey: SHORTCUT_HELP_LABEL_KEYS[help.id] ?? help.label,
      chord,
      ...(chord?.length === 1 && chord[0] ? { keys: chord[0] } : {}),
      ...(help.note ? { note: help.note } : {}),
      ...(SHORTCUT_HELP_NOTE_KEYS[help.id] ? { noteKey: SHORTCUT_HELP_NOTE_KEYS[help.id] } : {}),
    });
  }

  const sectionOrder: ShortcutSectionId[] = [
    "navigation",
    "tabs-panes",
    "projects",
    "layout",
    "editor",
    // After File Editor: it reads as the narrower section it is, and it is the
    // only one that does not apply to every file you can open.
    "markdown-editor",
    "agent-input",
  ];

  return sectionOrder.flatMap((sectionId) => {
    const rows = rowsBySection.get(sectionId) ?? [];
    if (rows.length === 0) {
      return [];
    }
    return [
      {
        id: sectionId,
        title: SHORTCUT_HELP_SECTION_TITLES[sectionId],
        titleKey: SHORTCUT_HELP_SECTION_LABEL_KEYS[sectionId],
        rows,
      },
    ];
  });
}
