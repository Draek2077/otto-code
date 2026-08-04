export type KeyboardFocusScope =
  | "terminal"
  | "message-input"
  | "command-center"
  // The CM6 file editor. A narrower "editable" - every shortcut that steps
  // aside for a text field also steps aside here, but the editor additionally
  // owns combos (Mod+B → Go to Definition) that mean nothing in a plain input.
  | "code-editor"
  // The same editor holding a markdown file. A narrower "code-editor", and the
  // one scope in this union with a PARENT: a markdown file still wants Save,
  // Find and Go to line, so bindings scoped to `code-editor` match here too
  // (see FOCUS_SCOPE_PARENT in keyboard-shortcuts.ts). It exists because some
  // markdown combos must not be claimed in a code file - `Mod+K` is a link
  // here and the command center everywhere else.
  | "markdown-editor"
  | "editable"
  | "browser"
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
  | "workspace.project.pick"
  | "worktree.new"
  | "workspace.archive"
  | "workspace.pin"
  | "view.toggle.focus"
  | "theme.cycle"
  | "message-input.action"
  // File Editor actions. Unlike every other id here these are NOT dispatched by
  // the app - the focused CodeMirror editor executes them, from a keymap built
  // out of these very bindings (see editor/editor-key-bindings.ts). They live in
  // the registry so they are listed and rebindable in Settings, and so that
  // being focus-scoped they outrank a general binding on the same combo while
  // the editor has focus. See route-shortcut.ts for the other half of that.
  | "editor.save"
  | "editor.find"
  | "editor.goToLine"
  | "editor.goToDefinition"
  | "editor.findReferences"
  | "editor.renameSymbol"
  // Markdown Editor actions. Same non-dispatched arrangement as the File Editor
  // ids above, with one addition: their CM6 commands DECLINE outside markdown
  // context, so `Mod+B` runs bold in a `.md` file and falls through to Go to
  // definition in a `.ts` one, from a single keymap that knows neither.
  | "editor.markdown.bold"
  | "editor.markdown.italic"
  | "editor.markdown.code"
  | "editor.markdown.strikethrough"
  | "editor.markdown.link"
  | "editor.markdown.bulletList"
  | "editor.markdown.orderedList"
  | "editor.markdown.taskList"
  | "editor.markdown.toggleTask"
  | "editor.markdown.blockquote";

export type KeyboardShortcutPayload =
  | { index: number }
  | { delta: 1 | -1 }
  | { kind: MessageInputKeyboardActionKind }
  | null;
