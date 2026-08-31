import { describe, expect, it, vi } from "vitest";
import {
  buildEffectiveBindings,
  buildKeyboardShortcutHelpSections,
  type ChordState,
  getBindingIdForAction,
  getWorkspaceIndexJumpModifierKey,
  type KeyboardShortcutContext,
  type ParsedShortcutBinding,
  resolveKeyboardShortcut,
  resolveShortcutKeysForAction,
} from "./keyboard-shortcuts";
import { buildShortcutDiscoveryEntries } from "./shortcut-discovery";

function keyboardEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "",
    code: "",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    ...overrides,
  } as KeyboardEvent;
}

function shortcutContext(
  overrides: Partial<KeyboardShortcutContext> = {},
): KeyboardShortcutContext {
  return {
    isMac: false,
    isDesktop: false,
    focusScope: "other",
    commandCenterOpen: false,
    ...overrides,
  };
}

function initialChordState(): ChordState {
  return {
    candidateIndices: [],
    step: 0,
    timeoutId: null,
  };
}

function resolveShortcut(input: {
  event: Partial<KeyboardEvent>;
  context?: Partial<KeyboardShortcutContext>;
  chordState?: ChordState;
  onChordReset?: () => void;
  bindings?: readonly ParsedShortcutBinding[];
}) {
  return resolveKeyboardShortcut({
    event: keyboardEvent(input.event),
    context: shortcutContext(input.context),
    chordState: input.chordState ?? initialChordState(),
    onChordReset: input.onChordReset ?? (() => undefined),
    ...(input.bindings ? { bindings: input.bindings } : {}),
  });
}

function expectShortcutResolution(input: {
  event: Partial<KeyboardEvent>;
  context?: Partial<KeyboardShortcutContext>;
  action: string;
  payload?: unknown;
  preventDefault?: boolean;
  stopPropagation?: boolean;
}) {
  const result = resolveShortcut({
    event: input.event,
    context: input.context,
  });

  expect(result.match?.preventDefault).toBe(input.preventDefault ?? true);
  expect(result.match?.stopPropagation).toBe(input.stopPropagation ?? true);
  expect(result.preventDefault).toBe(false);
  expect(result.nextChordState).toEqual(initialChordState());
}

function expectNoShortcutResolution(input: {
  event: Partial<KeyboardEvent>;
  context?: Partial<KeyboardShortcutContext>;
}) {
  const result = resolveShortcut({
    event: input.event,
    context: input.context,
  });

  expect(result.match).toBeNull();
  expect(result.preventDefault).toBe(false);
  expect(result.nextChordState).toEqual(initialChordState());
}

interface MatchingShortcutCase {
  name: string;
  event: Partial<KeyboardEvent>;
  context?: Partial<KeyboardShortcutContext>;
  action: string;
  payload?: unknown;
  preventDefault?: boolean;
  stopPropagation?: boolean;
}

interface NonMatchingShortcutCase {
  name: string;
  event: Partial<KeyboardEvent>;
  context?: Partial<KeyboardShortcutContext>;
}

interface HelpSectionCase {
  name: string;
  context: {
    isMac: boolean;
    isDesktop: boolean;
  };
  expectedKeys: Record<string, string[]>;
}

describe("keyboard-shortcuts", () => {
  const matchingCases: MatchingShortcutCase[] = [
    {
      name: "matches Cmd+O to open project",
      event: { key: "o", code: "KeyO", metaKey: true },
      context: { isMac: true },
      action: "agent.new",
    },
    {
      name: "matches Cmd+N to create new workspace on mac",
      event: { key: "n", code: "KeyN", metaKey: true },
      context: { isMac: true, commandCenterOpen: false },
      action: "workspace.new",
    },
    {
      name: "matches Ctrl+N to create new workspace on non-mac",
      event: { key: "n", code: "KeyN", ctrlKey: true },
      context: { isMac: false, commandCenterOpen: false, focusScope: "other" },
      action: "workspace.new",
    },
    {
      name: "matches question-mark shortcut to toggle the shortcuts dialog",
      event: { key: "?", code: "Slash", shiftKey: true },
      context: { focusScope: "other" },
      action: "shortcuts.dialog.toggle",
    },
    {
      name: "matches workspace index jump on web via Alt+digit",
      event: { key: "2", code: "Digit2", altKey: true },
      context: { isDesktop: false },
      action: "workspace.navigate.index",
      payload: { index: 2 },
    },
    {
      name: "matches workspace index jump on desktop via Mod+digit",
      event: { key: "2", code: "Digit2", metaKey: true },
      context: { isMac: true, isDesktop: true },
      action: "workspace.navigate.index",
      payload: { index: 2 },
    },
    {
      name: "matches tab index jump on mac desktop via Cmd+Alt+digit",
      event: { key: "@", code: "Digit2", metaKey: true, altKey: true },
      context: { isMac: true, isDesktop: true },
      action: "workspace.tab.navigate.index",
      payload: { index: 2 },
    },
    {
      name: "matches tab index jump on non-mac desktop via Alt+digit",
      event: { key: "2", code: "Digit2", altKey: true },
      context: { isMac: false, isDesktop: true },
      action: "workspace.tab.navigate.index",
      payload: { index: 2 },
    },
    {
      name: "matches tab index jump on web via Alt+Shift+digit",
      event: { key: "@", code: "Digit2", altKey: true, shiftKey: true },
      context: { isDesktop: false },
      action: "workspace.tab.navigate.index",
      payload: { index: 2 },
    },
    {
      name: "matches workspace relative navigation on web via Alt+[",
      event: { key: "[", code: "BracketLeft", altKey: true },
      context: { isDesktop: false },
      action: "workspace.navigate.relative",
      payload: { delta: -1 },
    },
    {
      name: "matches workspace relative navigation on desktop via Mod+]",
      event: { key: "]", code: "BracketRight", ctrlKey: true },
      context: { isDesktop: true },
      action: "workspace.navigate.relative",
      payload: { delta: 1 },
    },
    {
      name: "matches tab relative navigation via Alt+Shift+]",
      event: { key: "}", code: "BracketRight", altKey: true, shiftKey: true },
      action: "workspace.tab.navigate.relative",
      payload: { delta: 1 },
    },
    {
      name: "matches Mod+T to open new tab",
      event: { key: "t", code: "KeyT", metaKey: true },
      context: { isMac: true },
      action: "workspace.tab.menu.open",
    },
    {
      name: "matches Alt+Shift+W to close current tab on web",
      event: { key: "W", code: "KeyW", altKey: true, shiftKey: true },
      context: { isDesktop: false },
      action: "workspace.tab.close.current",
    },
    {
      name: "matches Cmd+W to close current tab on mac desktop",
      event: { key: "w", code: "KeyW", metaKey: true },
      context: { isMac: true, isDesktop: true },
      action: "workspace.tab.close.current",
    },
    {
      name: "matches Ctrl+W to close current tab on non-mac desktop",
      event: { key: "w", code: "KeyW", ctrlKey: true },
      context: { isMac: false, isDesktop: true },
      action: "workspace.tab.close.current",
    },
    {
      name: "matches Ctrl+O to open project on non-mac",
      event: { key: "o", code: "KeyO", ctrlKey: true },
      context: { isMac: false },
      action: "agent.new",
    },
    {
      name: "matches Ctrl+K for command center on non-mac",
      event: { key: "k", code: "KeyK", ctrlKey: true },
      context: { isMac: false },
      action: "command-center.toggle",
    },
    {
      name: "matches Cmd+Backslash to split pane right on macOS",
      event: { key: "\\", code: "Backslash", metaKey: true },
      context: { isMac: true },
      action: "workspace.pane.split.right",
    },
    {
      name: "matches Cmd+Shift+Backslash to split pane down on macOS",
      event: { key: "|", code: "Backslash", metaKey: true, shiftKey: true },
      context: { isMac: true },
      action: "workspace.pane.split.down",
    },
    {
      name: "matches Ctrl+Backslash to split pane right on non-mac platforms",
      event: { key: "\\", code: "Backslash", ctrlKey: true },
      context: { isMac: false },
      action: "workspace.pane.split.right",
    },
    {
      name: "matches Ctrl+Shift+Backslash to split pane down on non-mac platforms",
      event: { key: "|", code: "Backslash", ctrlKey: true, shiftKey: true },
      context: { isMac: false },
      action: "workspace.pane.split.down",
    },
    {
      name: "matches Cmd+Shift+ArrowRight to focus pane right on macOS",
      event: { key: "ArrowRight", code: "ArrowRight", metaKey: true, shiftKey: true },
      context: { isMac: true },
      action: "workspace.pane.focus.right",
    },
    {
      name: "matches Cmd+Shift+Alt+ArrowDown to move tab down on macOS",
      event: {
        key: "ArrowDown",
        code: "ArrowDown",
        metaKey: true,
        shiftKey: true,
        altKey: true,
      },
      context: { isMac: true },
      action: "workspace.pane.move-tab.down",
    },
    {
      name: "matches Cmd+Shift+W to close pane on macOS",
      event: { key: "W", code: "KeyW", metaKey: true, shiftKey: true },
      context: { isMac: true },
      action: "workspace.pane.close",
    },
    {
      name: "matches Cmd+B sidebar toggle on macOS",
      event: { key: "b", code: "KeyB", metaKey: true },
      context: { isMac: true },
      action: "sidebar.toggle.left",
    },
    // Mod+B steps aside only for the file editor, not for text fields at large:
    // the composer holds focus most of the time, and Mod+B means nothing there.
    // Nothing on the sidebar binding says so - the editor's own Mod+B is
    // focus-scoped and simply outranks it there. See the specificity block below.
    {
      name: "still toggles the left sidebar with Cmd+B from the composer",
      event: { key: "b", code: "KeyB", metaKey: true },
      context: { isMac: true, focusScope: "message-input" },
      action: "sidebar.toggle.left",
    },
    {
      name: "still toggles the left sidebar with Ctrl+B from a plain text field",
      event: { key: "b", code: "KeyB", ctrlKey: true },
      context: { isMac: false, focusScope: "editable" },
      action: "sidebar.toggle.left",
    },
    {
      name: "opens chat find with Ctrl+F from the composer",
      event: { key: "f", code: "KeyF", ctrlKey: true },
      context: { isMac: false, focusScope: "message-input" },
      action: "chat.find",
    },
    {
      name: "opens chat find with Ctrl+F from the active chat tab",
      event: { key: "f", code: "KeyF", ctrlKey: true },
      context: { isMac: false, focusScope: "other" },
      action: "chat.find",
    },
    // --- File Editor section: the same combo, two owners, focus decides ---
    {
      name: "runs the editor's go-to-definition on Cmd+B while the editor is focused",
      event: { key: "b", code: "KeyB", metaKey: true },
      context: { isMac: true, focusScope: "code-editor" },
      action: "editor.goToDefinition",
    },
    {
      name: "runs the editor's find on Ctrl+F while the editor is focused",
      event: { key: "f", code: "KeyF", ctrlKey: true },
      context: { isMac: false, focusScope: "code-editor" },
      action: "editor.find",
    },
    {
      name: "runs the editor's save on Mod+S, a combo no general binding claims",
      event: { key: "s", code: "KeyS", metaKey: true },
      context: { isMac: true, focusScope: "code-editor" },
      action: "editor.save",
    },
    {
      name: "runs go-to-definition from the F12 alias too",
      event: { key: "F12", code: "F12" },
      context: { focusScope: "code-editor" },
      action: "editor.goToDefinition",
    },
    {
      name: "runs find references on Shift+F12",
      event: { key: "F12", code: "F12", shiftKey: true },
      context: { focusScope: "code-editor" },
      action: "editor.findReferences",
    },
    {
      name: "runs rename symbol on F2",
      event: { key: "F2", code: "F2" },
      context: { focusScope: "code-editor" },
      action: "editor.renameSymbol",
    },
    // --- Markdown Editor: a narrower scope that INHERITS the one above ---
    {
      name: "runs markdown bold on Mod+B in a markdown file, not go-to-definition",
      event: { key: "b", code: "KeyB", metaKey: true },
      context: { isMac: true, focusScope: "markdown-editor" },
      action: "editor.markdown.bold",
    },
    {
      name: "keeps Save working in a markdown file, inherited from the File Editor scope",
      event: { key: "s", code: "KeyS", metaKey: true },
      context: { isMac: true, focusScope: "markdown-editor" },
      action: "editor.save",
    },
    {
      name: "keeps Find working in a markdown file, inherited the same way",
      event: { key: "f", code: "KeyF", ctrlKey: true },
      context: { isMac: false, focusScope: "markdown-editor" },
      action: "editor.find",
    },
    {
      name: "makes Mod+K a link in a markdown file",
      event: { key: "k", code: "KeyK", metaKey: true },
      context: { isMac: true, focusScope: "markdown-editor" },
      action: "editor.markdown.link",
    },
    // The reason the markdown scope exists at all: claiming these combos at
    // code-editor scope would take them away in every code file, where the
    // markdown command declines and the key would simply die.
    {
      name: "leaves Mod+K as the command center in a code file",
      event: { key: "k", code: "KeyK", metaKey: true },
      context: { isMac: true, focusScope: "code-editor" },
      action: "command-center.toggle",
    },
    {
      name: "runs the editor's go-to-line on Mod+G, one combo across both platforms",
      event: { key: "g", code: "KeyG", ctrlKey: true },
      context: { isMac: false, focusScope: "code-editor" },
      action: "editor.goToLine",
    },
    // Non-overlapping Otto shortcuts keep working in the editor - the override
    // is per-combo, not a modal takeover of the whole keyboard.
    {
      name: "still opens the command center with Ctrl+K from the editor",
      event: { key: "k", code: "KeyK", ctrlKey: true },
      context: { isMac: false, focusScope: "code-editor" },
      action: "command-center.toggle",
    },
    {
      name: "still cycles the theme with Ctrl+Alt+T from the editor",
      event: { key: "t", code: "KeyT", ctrlKey: true, altKey: true },
      context: { isMac: false, focusScope: "code-editor" },
      action: "theme.cycle",
    },
    {
      name: "routes Mod+. to toggle both sidebars on non-mac",
      event: { key: ".", code: "Period", ctrlKey: true },
      context: { isMac: false },
      action: "sidebar.toggle.both",
    },
    {
      name: "matches Dvorak logical Cmd+. to toggle both sidebars on macOS",
      event: { key: ".", code: "KeyE", metaKey: true },
      context: { isMac: true },
      action: "sidebar.toggle.both",
    },
    {
      name: "routes Mod+D to message-input action outside terminal",
      event: { key: "d", code: "KeyD", metaKey: true },
      context: { isMac: true, focusScope: "message-input" },
      action: "message-input.action",
      payload: { kind: "dictation-toggle" },
    },
    {
      name: "routes Shift+Tab to cycle agent mode from the message input",
      event: { key: "Tab", code: "Tab", shiftKey: true },
      context: { focusScope: "message-input" },
      action: "message-input.action",
      payload: { kind: "mode-cycle" },
    },
    {
      name: "routes space to voice mute toggle outside editable scopes",
      event: { key: " ", code: "Space" },
      context: { focusScope: "other" },
      action: "message-input.action",
      payload: { kind: "voice-mute-toggle" },
    },
    {
      name: "routes Escape to agent interrupt outside terminal focus",
      event: { key: "Escape", code: "Escape" },
      context: { focusScope: "message-input" },
      action: "agent.interrupt",
      preventDefault: false,
      stopPropagation: false,
    },
    // macOS rewrites event.key when Option is held (Option+T -> "†",
    // Option+[ -> "“", Option+Shift+W -> "„", etc.). Every Alt-bound
    // letter / bracket shortcut must still resolve.
    {
      name: "matches Cmd+Alt+T to cycle theme on macOS when Option substitutes event.key",
      event: { key: "\u2020", code: "KeyT", metaKey: true, altKey: true },
      context: { isMac: true },
      action: "theme.cycle",
    },
    {
      name: "matches Alt+Shift+[ to previous tab on macOS when Option substitutes event.key",
      event: { key: "\u201D", code: "BracketLeft", altKey: true, shiftKey: true },
      context: { isMac: true },
      action: "workspace.tab.navigate.relative",
      payload: { delta: -1 },
    },
    {
      name: "matches Alt+Shift+] to next tab on macOS when Option substitutes event.key",
      event: { key: "\u2019", code: "BracketRight", altKey: true, shiftKey: true },
      context: { isMac: true },
      action: "workspace.tab.navigate.relative",
      payload: { delta: 1 },
    },
    {
      name: "matches Alt+[ to previous workspace on macOS web when Option substitutes event.key",
      event: { key: "\u201C", code: "BracketLeft", altKey: true },
      context: { isMac: true, isDesktop: false },
      action: "workspace.navigate.relative",
      payload: { delta: -1 },
      preventDefault: true,
      stopPropagation: true,
    },
    {
      name: "matches Alt+] to next workspace on macOS web when Option substitutes event.key",
      event: { key: "\u2018", code: "BracketRight", altKey: true },
      context: { isMac: true, isDesktop: false },
      action: "workspace.navigate.relative",
      payload: { delta: 1 },
      preventDefault: true,
      stopPropagation: true,
    },
    {
      name: "matches Alt+Shift+W to close current tab on macOS web when Option substitutes event.key",
      event: { key: "\u201E", code: "KeyW", altKey: true, shiftKey: true },
      context: { isMac: true, isDesktop: false },
      action: "workspace.tab.close.current",
    },
  ];

  it.each(matchingCases)(
    "$name",
    ({ event, context, action, payload, preventDefault, stopPropagation }) => {
      expectShortcutResolution({
        event,
        context,
        action,
        ...(payload !== undefined ? { payload } : {}),
        ...(preventDefault !== undefined ? { preventDefault } : {}),
        ...(stopPropagation !== undefined ? { stopPropagation } : {}),
      });
    },
  );

  const nonMatchingCases: NonMatchingShortcutCase[] = [
    {
      name: "does not keep old Mod+Alt+N binding",
      event: { key: "n", code: "KeyN", metaKey: true, altKey: true },
      context: { isMac: true },
    },
    {
      name: "does not keep old Alt+Shift+T binding",
      event: { key: "T", code: "KeyT", altKey: true, shiftKey: true },
    },
    {
      name: "does not keep old Cmd+Shift+O open-project binding after rebind to Cmd+O",
      event: { key: "O", code: "KeyO", metaKey: true, shiftKey: true },
      context: { isMac: true },
    },
    {
      name: "does not keep old Ctrl+Shift+O open-project binding after rebind to Ctrl+O",
      event: { key: "O", code: "KeyO", ctrlKey: true, shiftKey: true },
      context: { isMac: false },
    },
    {
      name: "does not match question-mark shortcut inside editable scopes",
      event: { key: "?", code: "Slash", shiftKey: true },
      context: { focusScope: "message-input" },
    },
    // The file editor is also an editable surface, so editable:false bindings
    // keep standing down there. (Mod+B and Mod+F resolving to the EDITOR's own
    // actions in that scope is asserted in the matching cases above.)
    {
      name: "keeps Cmd+Shift+ArrowUp available for selection inside the file editor",
      event: { key: "ArrowUp", code: "ArrowUp", metaKey: true, shiftKey: true },
      context: { isMac: true, focusScope: "code-editor" },
    },
    // The File Editor section is scoped to the editor and to nothing else: its
    // bindings must not leak into the composer or a plain text field.
    {
      name: "does not run the editor's save from the composer",
      event: { key: "s", code: "KeyS", ctrlKey: true },
      context: { isMac: false, focusScope: "message-input" },
    },
    {
      name: "does not run rename symbol from outside the editor",
      event: { key: "F2", code: "F2" },
      context: { focusScope: "other" },
    },
    {
      name: "does not run find references from a plain text field",
      event: { key: "F12", code: "F12", shiftKey: true },
      context: { focusScope: "editable" },
    },
    {
      name: "does not close tab with Ctrl+W on mac desktop (Cmd+W only)",
      event: { key: "w", code: "KeyW", ctrlKey: true },
      context: { isMac: true, isDesktop: true },
    },
    {
      name: "does not close tab with Ctrl+W on non-mac desktop when terminal is focused",
      event: { key: "w", code: "KeyW", ctrlKey: true },
      context: { isMac: false, isDesktop: true, focusScope: "terminal" },
    },
    {
      name: "does not match Ctrl+T on mac (Cmd only)",
      event: { key: "t", code: "KeyT", ctrlKey: true },
      context: { isMac: true },
    },
    {
      name: "keeps mac Option+digit available for international text input",
      event: { key: "@", code: "Digit2", altKey: true },
      context: { isMac: true, isDesktop: true, focusScope: "message-input" },
    },
    {
      name: "does not match Ctrl+K for command center on non-mac in terminal",
      event: { key: "k", code: "KeyK", ctrlKey: true },
      context: { isMac: false, focusScope: "terminal" },
    },
    {
      name: "does not bind Ctrl+B on non-mac while terminal is focused",
      event: { key: "b", code: "KeyB", ctrlKey: true },
      context: { isMac: false, focusScope: "terminal" },
    },
    {
      name: "does not route message-input actions when terminal is focused",
      event: { key: "d", code: "KeyD", metaKey: true },
      context: { isMac: true, focusScope: "terminal" },
    },
    {
      name: "does not cycle agent mode outside the message input",
      event: { key: "Tab", code: "Tab", shiftKey: true },
      context: { focusScope: "other" },
    },
    {
      name: "does not repeat agent mode cycling while Shift+Tab is held",
      event: { key: "Tab", code: "Tab", shiftKey: true, repeat: true },
      context: { focusScope: "message-input" },
    },
    {
      name: "does not bind Cmd+Enter as a rebindable message queue shortcut",
      event: { key: "Enter", code: "Enter", metaKey: true },
      context: { isMac: true, focusScope: "message-input" },
    },
    {
      name: "does not bind Ctrl+Enter as a rebindable message queue shortcut",
      event: { key: "Enter", code: "Enter", ctrlKey: true },
      context: { isMac: false, focusScope: "message-input" },
    },
    {
      name: "does not interrupt agent when terminal is focused",
      event: { key: "Escape", code: "Escape" },
      context: { focusScope: "terminal" },
    },
    {
      name: "does not interrupt agent when command center is open",
      event: { key: "Escape", code: "Escape" },
      context: { commandCenterOpen: true },
    },
    {
      name: "keeps Cmd+Shift+ArrowRight available for message input selection",
      event: { key: "ArrowRight", code: "ArrowRight", metaKey: true, shiftKey: true },
      context: { isMac: true, focusScope: "message-input" },
    },
    {
      name: "keeps Cmd+Shift+ArrowLeft available for generic editable selection",
      event: { key: "ArrowLeft", code: "ArrowLeft", metaKey: true, shiftKey: true },
      context: { isMac: true, focusScope: "editable" },
    },
    {
      name: "keeps space typing available in message input",
      event: { key: " ", code: "Space" },
      context: { focusScope: "message-input" },
    },
    {
      name: "keeps Dvorak Cmd+V available for paste in message input",
      event: { key: "v", code: "Period", metaKey: true },
      context: { isMac: true, isDesktop: true, focusScope: "message-input" },
    },
    // Sanity: the macOS Option-substitution fallback must still respect
    // modifier checks - pressing Option+T alone (no Cmd) must not trigger
    // the Cmd+Alt+T theme-cycle binding.
    {
      name: "does not cycle theme on macOS when Cmd is missing (Alt+T alone)",
      event: { key: "\u2020", code: "KeyT", altKey: true },
      context: { isMac: true },
    },
  ];

  it.each(nonMatchingCases)("$name", ({ event, context }) => {
    expectNoShortcutResolution({ event, context });
  });

  it("prefers advancing chord candidates over single-combo matches on the same prefix", () => {
    const bindings = buildEffectiveBindings({
      "workspace-terminal-new-ctrl-shift-t-non-mac": "Ctrl+W S",
    });
    const chordBindingIndex = bindings.findIndex(
      (binding) => binding.id === "workspace-terminal-new-ctrl-shift-t-non-mac",
    );
    expect(chordBindingIndex).toBeGreaterThan(-1);

    const firstResult = resolveShortcut({
      event: { key: "w", code: "KeyW", ctrlKey: true },
      context: { isMac: false, isDesktop: true },
      bindings,
    });

    expect(firstResult.match).toBeNull();
    expect(firstResult.preventDefault).toBe(true);
    expect(firstResult.nextChordState.step).toBe(1);
    expect(firstResult.nextChordState.candidateIndices).toEqual([chordBindingIndex]);

    const secondResult = resolveShortcut({
      event: { key: "s", code: "KeyS" },
      context: { isMac: false, isDesktop: true },
      chordState: firstResult.nextChordState,
      bindings,
    });

    expect(secondResult.match?.action).toBe("workspace.terminal.new");
    expect(secondResult.match?.payload).toBeNull();
    expect(secondResult.match?.preventDefault).toBe(true);
    expect(secondResult.match?.stopPropagation).toBe(true);
    expect(secondResult.preventDefault).toBe(false);
    expect(secondResult.nextChordState).toEqual(initialChordState());
  });

  // The three cases the override mechanic has to get right, spelled out: which
  // of two bindings on a shared combo wins where, and that a user override on
  // EITHER side still beats the default.
  describe("File Editor bindings override general ones while the editor is focused", () => {
    it("gives the shared combo to the editor in the editor and to the app everywhere else", () => {
      expect(
        resolveShortcut({
          event: { key: "b", code: "KeyB", ctrlKey: true },
          context: { isMac: false, focusScope: "code-editor" },
        }).match?.action,
      ).toBe("editor.goToDefinition");

      expect(
        resolveShortcut({
          event: { key: "b", code: "KeyB", ctrlKey: true },
          context: { isMac: false, focusScope: "other" },
        }).match?.action,
      ).toBe("sidebar.toggle.left");
    });

    it("hands the combo back to the general binding once the editor is rebound off it", () => {
      const bindings = buildEffectiveBindings({ "editor-go-to-definition-mod-b": "F4" });

      expect(
        resolveShortcut({
          event: { key: "b", code: "KeyB", ctrlKey: true },
          context: { isMac: false, focusScope: "code-editor" },
          bindings,
        }).match?.action,
      ).toBe("sidebar.toggle.left");

      expect(
        resolveShortcut({
          event: { key: "F4", code: "F4" },
          context: { isMac: false, focusScope: "code-editor" },
          bindings,
        }).match?.action,
      ).toBe("editor.goToDefinition");
    });

    it("lets an editor binding override a general one it did not previously share", () => {
      // Mod+E is the right sidebar; rebinding the editor's find onto it must win
      // inside the editor and leave the sidebar alone outside it.
      const bindings = buildEffectiveBindings({ "editor-find-mod-f": "Ctrl+E" });

      expect(
        resolveShortcut({
          event: { key: "e", code: "KeyE", ctrlKey: true },
          context: { isMac: false, focusScope: "code-editor" },
          bindings,
        }).match?.action,
      ).toBe("editor.find");

      expect(
        resolveShortcut({
          event: { key: "e", code: "KeyE", ctrlKey: true },
          context: { isMac: false, focusScope: "other" },
          bindings,
        }).match?.action,
      ).toBe("sidebar.toggle.right");
    });

    it("keeps a rebound general binding out of the editor when the editor claims the combo", () => {
      // The user moves the changes sidebar onto Mod+S. Save still wins in the
      // editor, because specificity is decided per context, not per registry order.
      const bindings = buildEffectiveBindings({
        "sidebar-open-changes-ctrl-h-non-mac": "Ctrl+S",
      });

      expect(
        resolveShortcut({
          event: { key: "s", code: "KeyS", ctrlKey: true },
          context: { isMac: false, focusScope: "code-editor" },
          bindings,
        }).match?.action,
      ).toBe("editor.save");

      expect(
        resolveShortcut({
          event: { key: "s", code: "KeyS", ctrlKey: true },
          context: { isMac: false, focusScope: "other" },
          bindings,
        }).match?.action,
      ).toBe("sidebar.open.changes");
    });
  });

  it("schedules a chord reset timeout for advancing candidates", () => {
    vi.useFakeTimers();

    const bindings = buildEffectiveBindings({
      "workspace-terminal-new-ctrl-shift-t-non-mac": "Ctrl+W S",
    });
    const onChordReset = vi.fn();

    const result = resolveShortcut({
      event: { key: "w", code: "KeyW", ctrlKey: true },
      context: { isMac: false, isDesktop: true },
      onChordReset,
      bindings,
    });

    expect(result.match).toBeNull();
    expect(result.preventDefault).toBe(true);
    expect(result.nextChordState.timeoutId).not.toBeNull();

    vi.advanceTimersByTime(1500);

    expect(onChordReset).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("keyboard-shortcut help sections", () => {
  function findRow(sections: ReturnType<typeof buildKeyboardShortcutHelpSections>, id: string) {
    for (const section of sections) {
      const row = section.rows.find((candidate) => candidate.id === id);
      if (row) {
        return row;
      }
    }
    return null;
  }

  const helpCases: HelpSectionCase[] = [
    {
      name: "uses web defaults for workspace and tab jump",
      context: { isMac: true, isDesktop: false },
      expectedKeys: {
        "new-agent": ["mod", "O"],
        "workspace-tab-new": ["mod", "T"],
        "workspace-jump-index": ["alt", "1-9"],
        "workspace-tab-jump-index": ["alt", "shift", "1-9"],
        "workspace-tab-close-current": ["alt", "shift", "W"],
        "workspace-pane-split-right": ["mod", "\\"],
        "workspace-pane-close": ["mod", "shift", "W"],
        "cycle-agent-mode": ["shift", "Tab"],
      },
    },
    {
      name: "uses desktop defaults for workspace and tab jump",
      context: { isMac: true, isDesktop: true },
      expectedKeys: {
        "new-agent": ["mod", "O"],
        "new-workspace": ["mod", "N"],
        "workspace-tab-new": ["mod", "T"],
        "workspace-jump-index": ["mod", "1-9"],
        "workspace-tab-jump-index": ["mod", "alt", "1-9"],
        "workspace-tab-close-current": ["meta", "W"],
        "workspace-pane-split-right": ["mod", "\\"],
        "workspace-pane-close": ["mod", "shift", "W"],
      },
    },
    {
      name: "uses non-mac desktop defaults for tab jump and close tab",
      context: { isMac: false, isDesktop: true },
      expectedKeys: {
        "workspace-tab-jump-index": ["alt", "1-9"],
        "workspace-tab-close-current": ["ctrl", "W"],
        "workspace-pane-split-right": ["mod", "\\"],
        "workspace-pane-split-down": ["mod", "shift", "\\"],
      },
    },
    {
      name: "uses mod+b for the left sidebar and mod+period for both sidebars on non-mac",
      context: { isMac: false, isDesktop: false },
      expectedKeys: {
        "toggle-left-sidebar": ["mod", "B"],
        "toggle-both-sidebars": ["mod", "."],
      },
    },
  ];

  it.each(helpCases)("$name", ({ context, expectedKeys }) => {
    const sections = buildKeyboardShortcutHelpSections(context);

    for (const [id, keys] of Object.entries(expectedKeys)) {
      expect(findRow(sections, id)?.keys).toEqual(keys);
    }
  });

  it("returns stable i18n keys for section titles and help rows", () => {
    const sections = buildKeyboardShortcutHelpSections({ isMac: true, isDesktop: true });
    const projects = sections.find((section) => section.id === "projects");
    const layout = sections.find((section) => section.id === "layout");
    const openProject = findRow(sections, "new-agent");
    const cycleAgentMode = findRow(sections, "cycle-agent-mode");
    const showShortcuts = findRow(sections, "show-shortcuts");

    expect(projects?.titleKey).toBe("settings.shortcuts.sections.projects");
    expect(layout?.titleKey).toBe("settings.shortcuts.sections.layout");
    expect(openProject?.labelKey).toBe("settings.shortcuts.help.openProject");
    expect(openProject?.label).toBe("Open project");
    expect(cycleAgentMode?.labelKey).toBe("settings.shortcuts.help.cycleAgentMode");
    expect(showShortcuts?.noteKey).toBe("settings.shortcuts.helpNotes.showKeyboardShortcuts");
  });

  it("lists the File Editor section, identically on every platform", () => {
    for (const context of [
      { isMac: true, isDesktop: true },
      { isMac: false, isDesktop: false },
    ]) {
      const sections = buildKeyboardShortcutHelpSections(context);
      const editor = sections.find((section) => section.id === "editor");

      expect(editor?.titleKey).toBe("settings.shortcuts.sections.editor");
      expect(editor?.title).toBe("File Editor");
      // The section is written as single Mod+ bindings, so the same rows and the
      // same keys serve mac and non-mac; only the rendering differs.
      expect(editor?.rows.map((row) => row.id)).toEqual([
        "editor-save",
        "editor-find",
        "editor-go-to-line",
        "editor-go-to-definition",
        "editor-find-references",
        "editor-rename-symbol",
      ]);
      expect(findRow(sections, "editor-save")?.keys).toEqual(["mod", "S"]);
      expect(findRow(sections, "editor-rename-symbol")?.keys).toEqual(["F2"]);
      expect(findRow(sections, "editor-save")?.labelKey).toBe("settings.shortcuts.help.editorSave");
    }
  });

  it("makes every File Editor row rebindable, and the F12 alias not a row of its own", () => {
    const platform = { isMac: false, isDesktop: true };
    for (const id of [
      "editor-save",
      "editor-find",
      "editor-go-to-line",
      "editor-go-to-definition",
      "editor-find-references",
      "editor-rename-symbol",
    ]) {
      expect(getBindingIdForAction(id, platform)).not.toBeNull();
    }
    // One feature, one row: F12 stays an alias with no row to rebind.
    expect(getBindingIdForAction("editor-go-to-definition", platform)).toBe(
      "editor-go-to-definition-mod-b",
    );
  });

  it("does not expose Enter send behavior as rebindable shortcut rows", () => {
    const sections = buildKeyboardShortcutHelpSections({ isMac: true, isDesktop: true });

    expect(findRow(sections, "message-input-send")).toBeNull();
    expect(findRow(sections, "message-input-queue")).toBeNull();
    expect(
      getBindingIdForAction("message-input-send", { isMac: true, isDesktop: true }),
    ).toBeNull();
    expect(
      getBindingIdForAction("message-input-queue", { isMac: true, isDesktop: true }),
    ).toBeNull();
  });
});

describe("contextual shortcut discovery", () => {
  it("uses the focused editor binding rather than an app-wide binding on the same held prefix", () => {
    const entries = buildShortcutDiscoveryEntries({
      bindings: buildEffectiveBindings({}),
      context: shortcutContext({ isMac: false, focusScope: "code-editor" }),
      heldModifiers: { alt: false, ctrl: true, meta: false, shift: false },
    });

    // Exactly B, not "contains B": Ctrl+Shift+B is a real further chord from
    // this same prefix, and it is not the one this asserts on.
    const modB = entries.find(
      (entry) => entry.remainingKeys.length === 1 && entry.remainingKeys[0] === "B",
    );
    expect(modB?.action).toBe("editor.goToDefinition");
    expect(modB?.label).toBe("Go to definition");
  });

  it("narrows a modifier-plus-shift chord to the final key once Shift is held", () => {
    const entries = buildShortcutDiscoveryEntries({
      bindings: buildEffectiveBindings({}),
      context: shortcutContext({ isMac: false }),
      heldModifiers: { alt: false, ctrl: true, meta: false, shift: true },
    });

    const newTerminal = entries.find((entry) => entry.label === "New terminal");
    expect(newTerminal?.remainingKeys).toEqual(["T"]);
    expect(newTerminal?.chord).toEqual([["ctrl", "shift", "T"]]);
  });

  it("reveals Shift-only commands when Shift is the first held modifier", () => {
    const entries = buildShortcutDiscoveryEntries({
      bindings: buildEffectiveBindings({}),
      context: shortcutContext({ isMac: false, focusScope: "message-input" }),
      heldModifiers: { alt: false, ctrl: false, meta: false, shift: true },
    });

    expect(
      entries.find((entry) => entry.bindingId === "message-input-mode-cycle-shift-tab")
        ?.remainingKeys,
    ).toEqual(["Tab"]);
  });

  it("progressively reveals the focused Voice Mode command by its concrete binding", () => {
    const options = {
      bindings: buildEffectiveBindings({}),
      context: shortcutContext({ isMac: false, focusScope: "message-input" }),
    };

    const firstPass = buildShortcutDiscoveryEntries({
      ...options,
      heldModifiers: { alt: false, ctrl: true, meta: false, shift: false },
    });
    const secondPass = buildShortcutDiscoveryEntries({
      ...options,
      heldModifiers: { alt: false, ctrl: true, meta: false, shift: true },
    });

    expect(
      firstPass.find(
        (entry) => entry.bindingId === "message-input-voice-toggle-ctrl-shift-d-non-mac",
      )?.remainingKeys,
    ).toEqual(["shift", "D"]);
    expect(
      secondPass.find(
        (entry) => entry.bindingId === "message-input-voice-toggle-ctrl-shift-d-non-mac",
      )?.remainingKeys,
    ).toEqual(["D"]);
  });

  it("keeps the focused Dictation command distinct from Voice Mode", () => {
    const entries = buildShortcutDiscoveryEntries({
      bindings: buildEffectiveBindings({}),
      context: shortcutContext({ isMac: false, focusScope: "message-input" }),
      heldModifiers: { alt: false, ctrl: true, meta: false, shift: false },
    });

    expect(
      entries.find((entry) => entry.bindingId === "message-input-dictation-toggle-ctrl-d-non-mac")
        ?.remainingKeys,
    ).toEqual(["D"]);
    expect(
      entries.find((entry) => entry.bindingId === "message-input-voice-toggle-ctrl-shift-d-non-mac")
        ?.remainingKeys,
    ).toEqual(["shift", "D"]);
  });

  it("keeps the message-input focus binding available for its input revealer", () => {
    const entries = buildShortcutDiscoveryEntries({
      bindings: buildEffectiveBindings({}),
      context: shortcutContext({ isMac: false, focusScope: "other" }),
      heldModifiers: { alt: false, ctrl: true, meta: false, shift: false },
    });

    expect(
      entries.find((entry) => entry.bindingId === "message-input-focus-ctrl-l-non-mac")
        ?.remainingKeys,
    ).toEqual(["L"]);
  });

  it("reveals the New Workspace project picker from its Ctrl/Cmd prefix", () => {
    const entries = buildShortcutDiscoveryEntries({
      bindings: buildEffectiveBindings({}),
      context: shortcutContext({ isMac: false }),
      heldModifiers: { alt: false, ctrl: true, meta: false, shift: false },
    });

    expect(
      entries.find((entry) => entry.bindingId === "workspace-project-pick-ctrl-p-non-mac")
        ?.remainingKeys,
    ).toEqual(["P"]);
  });

  it("reveals Open Project from its Ctrl/Cmd prefix", () => {
    const entries = buildShortcutDiscoveryEntries({
      bindings: buildEffectiveBindings({}),
      context: shortcutContext({ isMac: false }),
      heldModifiers: { alt: false, ctrl: true, meta: false, shift: false },
    });

    expect(
      entries.find((entry) => entry.bindingId === "agent-new-ctrl-shift-o-non-mac")?.remainingKeys,
    ).toEqual(["O"]);
  });

  it("uses Alt as the held prefix for web workspace navigation", () => {
    const entries = buildShortcutDiscoveryEntries({
      bindings: buildEffectiveBindings({}),
      context: shortcutContext({ isDesktop: false }),
      heldModifiers: { alt: true, ctrl: false, meta: false, shift: false },
    });

    expect(entries.some((entry) => entry.action === "workspace.navigate.index")).toBe(true);
  });

  it("progressively reveals web tab index navigation after Alt then Shift", () => {
    const options = {
      bindings: buildEffectiveBindings({}),
      context: shortcutContext({ isDesktop: false }),
    };

    const firstPass = buildShortcutDiscoveryEntries({
      ...options,
      heldModifiers: { alt: true, ctrl: false, meta: false, shift: false },
    });
    const secondPass = buildShortcutDiscoveryEntries({
      ...options,
      heldModifiers: { alt: true, ctrl: false, meta: false, shift: true },
    });

    expect(
      firstPass.find((entry) => entry.action === "workspace.tab.navigate.index")?.remainingKeys,
    ).toEqual(["shift", "1-9"]);
    expect(
      secondPass.find((entry) => entry.action === "workspace.tab.navigate.index")?.remainingKeys,
    ).toEqual(["1-9"]);
  });
});

describe("getWorkspaceIndexJumpModifierKey", () => {
  it("uses Alt on web, regardless of OS", () => {
    expect(getWorkspaceIndexJumpModifierKey({ isMac: true, isDesktop: false })).toBe("Alt");
    expect(getWorkspaceIndexJumpModifierKey({ isMac: false, isDesktop: false })).toBe("Alt");
  });

  it("uses Cmd (Meta) on desktop Mac, not Control or Alt", () => {
    expect(getWorkspaceIndexJumpModifierKey({ isMac: true, isDesktop: true })).toBe("Meta");
  });

  it("uses Ctrl on desktop non-Mac, not Meta or Alt", () => {
    expect(getWorkspaceIndexJumpModifierKey({ isMac: false, isDesktop: true })).toBe("Control");
  });
});

describe("direct new-tab target shortcuts", () => {
  const desktopNonMac = { isMac: false, isDesktop: true };
  const targetCases = [
    ["a", "KeyA", "workspace.tab.target.agent"],
    ["b", "KeyB", "workspace.tab.target.browser"],
    ["g", "KeyG", "workspace.tab.target.changes"],
    ["e", "KeyE", "workspace.tab.target.files"],
  ] as const;

  it("leaves bare letters to the open menu", () => {
    const result = resolveShortcut({
      event: { key: "a", code: "KeyA" },
      context: { ...desktopNonMac, focusScope: "other" },
      bindings: buildEffectiveBindings({}),
    });

    expect(result.match).toBeNull();
  });

  it.each(targetCases)("routes Ctrl+Shift+%s directly to %s", (key, code, action) => {
    const result = resolveShortcut({
      event: { key, code, ctrlKey: true, shiftKey: true },
      context: { ...desktopNonMac, focusScope: "other" },
      bindings: buildEffectiveBindings({}),
    });
    expect(result.match?.action).toBe(action);
  });

  it.each(targetCases)("routes Cmd+Shift+%s directly to %s", (key, code, action) => {
    const result = resolveShortcut({
      event: { key, code, metaKey: true, shiftKey: true },
      context: { isMac: true, isDesktop: true, focusScope: "other" },
      bindings: buildEffectiveBindings({}),
    });
    expect(result.match?.action).toBe(action);
  });

  it("uses the existing override map for target matching and display", () => {
    const bindingId = "workspace-tab-target-agent-ctrl-shift-a-non-mac";
    const overrides = { [bindingId]: "Ctrl+Shift+H" };
    const rebound = resolveShortcut({
      event: { key: "h", code: "KeyH", ctrlKey: true, shiftKey: true },
      context: { ...desktopNonMac, focusScope: "other" },
      bindings: buildEffectiveBindings(overrides),
    });
    const original = resolveShortcut({
      event: { key: "a", code: "KeyA", ctrlKey: true, shiftKey: true },
      context: { ...desktopNonMac, focusScope: "other" },
      bindings: buildEffectiveBindings(overrides),
    });

    expect(rebound.match?.action).toBe("workspace.tab.target.agent");
    expect(original.match).toBeNull();
    expect(
      resolveShortcutKeysForAction("workspace-tab-target-agent", overrides, desktopNonMac),
    ).toEqual([["ctrl", "shift", "H"]]);
  });
});
