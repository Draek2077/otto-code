export type KeyboardFocusScope =
  | "terminal"
  | "message-input"
  | "command-center"
  // The CM6 file editor. A narrower "editable" — every shortcut that steps
  // aside for a text field also steps aside here, but the editor additionally
  // owns combos (Mod+B → Go to Definition) that mean nothing in a plain input.
  | "code-editor"
  | "editable"
  | "other";

export type MessageInputKeyboardActionKind =
  | "focus"
  | "send"
  | "dictation-toggle"
  | "dictation-cancel"
  | "dictation-confirm"
  | "voice-toggle"
  | "voice-mute-toggle"
  | "mode-cycle";

export type KeyboardActionId =
  | "agent.interrupt"
  | "agent.new"
  | "workspace.tab.new"
  | "workspace.tab.close.current"
  | "workspace.tab.navigate.index"
  | "workspace.tab.navigate.relative"
  | "workspace.pane.split.right"
  | "workspace.pane.split.down"
  | "workspace.pane.focus.left"
  | "workspace.pane.focus.right"
  | "workspace.pane.focus.up"
  | "workspace.pane.focus.down"
  | "workspace.pane.move-tab.left"
  | "workspace.pane.move-tab.right"
  | "workspace.pane.move-tab.up"
  | "workspace.pane.move-tab.down"
  | "workspace.pane.close"
  | "workspace.navigate.index"
  | "workspace.navigate.relative"
  | "sidebar.toggle.left"
  | "sidebar.toggle.right"
  | "sidebar.toggle.both"
  | "sidebar.open.files"
  | "sidebar.open.search"
  | "sidebar.open.changes"
  | "settings.toggle"
  | "command-center.toggle"
  | "shortcuts.dialog.toggle"
  | "workspace.terminal.new"
  | "workspace.new"
  | "worktree.new"
  | "workspace.archive"
  | "view.toggle.focus"
  | "theme.cycle"
  | "message-input.action";

export type KeyboardShortcutPayload =
  | { index: number }
  | { delta: 1 | -1 }
  | { kind: MessageInputKeyboardActionKind }
  | null;
