import type { EditorKeyAction } from "./contracts";
export const EDITOR_SHORTCUT_COMMANDS: Readonly<Record<string, EditorKeyAction>> = {
  "editor.save": "save",
  "editor.find": "find",
  "editor.goToLine": "goToLine",
  "editor.goToDefinition": "goToDefinition",
  "editor.findReferences": "findReferences",
  "editor.renameSymbol": "renameSymbol",
  "editor.markdown.bold": "markdownBold",
  "editor.markdown.italic": "markdownItalic",
  "editor.markdown.code": "markdownCode",
  "editor.markdown.strikethrough": "markdownStrikethrough",
  "editor.markdown.link": "markdownLink",
  "editor.markdown.bulletList": "markdownBulletList",
  "editor.markdown.orderedList": "markdownOrderedList",
  "editor.markdown.taskList": "markdownTaskList",
  "editor.markdown.toggleTask": "markdownToggleTask",
  "editor.markdown.blockquote": "markdownBlockquote",
  "editor.outline": "outline",
};
export type EditorShortcutActionId =
  | "editor.markdown.bold"
  | "editor.markdown.italic"
  | "editor.markdown.code"
  | "editor.markdown.strikethrough"
  | "editor.markdown.link"
  | "editor.markdown.bulletList"
  | "editor.markdown.orderedList"
  | "editor.markdown.taskList"
  | "editor.markdown.toggleTask"
  | "editor.markdown.blockquote"
  | "editor.save"
  | "editor.find"
  | "editor.goToLine"
  | "editor.goToDefinition"
  | "editor.findReferences"
  | "editor.renameSymbol"
  | "editor.outline";
export const EDITOR_SHORTCUT_BINDINGS = [
  {
    id: "markdown-bold-mod-b",
    action: "editor.markdown.bold",
    combo: "Mod+B",
    when: { focusScope: "markdown-editor" },
    help: { id: "markdown-bold", section: "markdown-editor", label: "Bold" },
  },
  {
    id: "markdown-italic-mod-i",
    action: "editor.markdown.italic",
    combo: "Mod+I",
    when: { focusScope: "markdown-editor" },
    help: { id: "markdown-italic", section: "markdown-editor", label: "Italic" },
  },
  {
    id: "markdown-code-mod-shift-c",
    action: "editor.markdown.code",
    combo: "Mod+Shift+C",
    when: { focusScope: "markdown-editor" },
    help: { id: "markdown-code", section: "markdown-editor", label: "Inline code" },
  },
  {
    id: "markdown-strikethrough-mod-shift-x",
    action: "editor.markdown.strikethrough",
    combo: "Mod+Shift+X",
    when: { focusScope: "markdown-editor" },
    help: { id: "markdown-strikethrough", section: "markdown-editor", label: "Strikethrough" },
  },
  {
    id: "markdown-link-mod-k",
    action: "editor.markdown.link",
    combo: "Mod+K",
    when: { focusScope: "markdown-editor" },
    help: { id: "markdown-link", section: "markdown-editor", label: "Insert link" },
  },
  {
    id: "markdown-bullet-list-mod-shift-u",
    action: "editor.markdown.bulletList",
    combo: "Mod+Shift+U",
    when: { focusScope: "markdown-editor" },
    help: { id: "markdown-bullet-list", section: "markdown-editor", label: "Bullet list" },
  },
  {
    id: "markdown-ordered-list-mod-shift-o",
    action: "editor.markdown.orderedList",
    combo: "Mod+Shift+O",
    when: { focusScope: "markdown-editor" },
    help: { id: "markdown-ordered-list", section: "markdown-editor", label: "Numbered list" },
  },
  {
    id: "markdown-task-list-mod-shift-l",
    action: "editor.markdown.taskList",
    combo: "Mod+Shift+L",
    when: { focusScope: "markdown-editor" },
    help: { id: "markdown-task-list", section: "markdown-editor", label: "Task list" },
  },
  {
    id: "markdown-toggle-task-mod-enter",
    action: "editor.markdown.toggleTask",
    combo: "Mod+Enter",
    when: { focusScope: "markdown-editor" },
    help: { id: "markdown-toggle-task", section: "markdown-editor", label: "Check/uncheck task" },
  },
  {
    id: "markdown-blockquote-mod-shift-q",
    action: "editor.markdown.blockquote",
    combo: "Mod+Shift+Q",
    when: { focusScope: "markdown-editor" },
    help: { id: "markdown-blockquote", section: "markdown-editor", label: "Blockquote" },
  },
  {
    id: "editor-save-mod-s",
    action: "editor.save",
    combo: "Mod+S",
    when: { focusScope: "code-editor" },
    help: { id: "editor-save", section: "editor", label: "Save file" },
  },
  {
    id: "editor-find-mod-f",
    action: "editor.find",
    combo: "Mod+F",
    when: { focusScope: "code-editor" },
    help: { id: "editor-find", section: "editor", label: "Find in file" },
  },
  {
    id: "editor-go-to-line-mod-g",
    action: "editor.goToLine",
    combo: "Alt+G", // Preserve Paseo's Mod+G Find-next; keep the persisted binding identity.
    when: { focusScope: "code-editor" },
    help: { id: "editor-go-to-line", section: "editor", label: "Go to line" },
  },
  {
    id: "editor-go-to-definition-mod-b",
    action: "editor.goToDefinition",
    combo: "Mod+B",
    when: { focusScope: "code-editor" },
    help: { id: "editor-go-to-definition", section: "editor", label: "Go to definition" },
  },
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
    help: { id: "editor-find-references", section: "editor", label: "Find references" },
  },
  {
    id: "editor-rename-symbol-f2",
    action: "editor.renameSymbol",
    combo: "F2",
    when: { focusScope: "code-editor" },
    help: { id: "editor-rename-symbol", section: "editor", label: "Rename symbol" },
  },
  {
    id: "editor-outline-mod-shift-o",
    action: "editor.outline",
    combo: "Mod+Shift+O",
    when: { focusScope: "code-editor" },
    help: { id: "editor-outline", section: "editor", label: "Document outline" },
  },
] as const;
