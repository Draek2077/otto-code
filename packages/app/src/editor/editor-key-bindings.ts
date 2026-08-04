import { useMemo } from "react";
import { useKeyboardShortcutOverrides } from "@/hooks/use-keyboard-shortcut-overrides";
import {
  buildEffectiveBindings,
  DEFAULT_BINDINGS,
  type ParsedShortcutBinding,
} from "@/keyboard/keyboard-shortcuts";
import { parseShortcutString, type KeyCombo } from "@/keyboard/shortcut-string";
import type { EditorKeyAction, EditorKeyBinding } from "./editor-contract";

// The registry → CodeMirror bridge: the shortcut registry owns the combos, CM6
// executes them.
//
// This is the app-side half and the ONLY place the two vocabularies meet, which
// is why it lives here rather than in editor-core: the core is bundled into the
// native webview and may not import from the registry (or from anything else in
// the app). It receives plain `EditorKeyBinding`s instead.
//
// The global keyboard hook still matches these bindings - that is what makes the
// editor's version beat a general binding on the same combo - but routes them
// nowhere, leaving the keystroke to reach the editor. See route-shortcut.ts.

const EDITOR_KEY_ACTIONS: Record<string, EditorKeyAction> = {
  // Markdown first, matching the registry's own order: `buildEditorKeyBindings`
  // preserves it, and CM6 tries same-key bindings in array order. Bold has to be
  // offered `Mod-b` before Go to definition is, or the markdown command never
  // gets the chance to claim it.
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
  "editor.save": "save",
  "editor.find": "find",
  "editor.goToLine": "goToLine",
  "editor.goToDefinition": "goToDefinition",
  "editor.findReferences": "findReferences",
  "editor.renameSymbol": "renameSymbol",
};

/**
 * The registry's key name in CodeMirror's spelling.
 *
 * `KeyCombo.key` is the printable character for the keys that have one ("s",
 * ","), which is exactly what CM6 matches on. Keys without one are named by
 * their `code`, and for this set - the function keys, Escape, the arrows,
 * Backspace and friends - the code IS the `KeyboardEvent.key`, so it carries
 * across unchanged. The one code that is not a real key is `Digit`, the
 * registry's wildcard for the 1-9 row; an editor command bound to it would be
 * meaningless, so it is dropped rather than mistranslated.
 */
function codeMirrorKeyName(combo: KeyCombo): string | null {
  if (combo.key !== undefined) {
    return combo.key;
  }
  return combo.code === "Digit" ? null : combo.code;
}

/**
 * One registry combo string ("Mod+S") as a CodeMirror key ("Mod-s"). Modifier
 * order does not matter - CM6 normalizes the name it is given - but the
 * modifiers themselves must survive, `Mod` included: it means the same
 * Cmd-on-mac/Ctrl-elsewhere thing in both systems, which is what keeps a single
 * registry row from having to split into a per-platform pair.
 *
 * Returns null for anything untranslatable, so a corrupt stored override drops
 * that one binding rather than breaking the whole keymap.
 */
export function comboStringToCodeMirrorKey(comboString: string): string | null {
  let combo: KeyCombo;
  try {
    combo = parseShortcutString(comboString);
  } catch {
    return null;
  }
  const name = codeMirrorKeyName(combo);
  if (name === null) {
    return null;
  }
  const parts: string[] = [];
  if (combo.mod) parts.push("Mod");
  if (combo.ctrl) parts.push("Ctrl");
  if (combo.meta) parts.push("Meta");
  if (combo.alt) parts.push("Alt");
  if (combo.shift) parts.push("Shift");
  parts.push(name);
  return parts.join("-");
}

/**
 * The File Editor rows of a set of effective bindings, as a CM6 keymap.
 *
 * Multi-step chords are skipped: CM6 has a prefix-map idiom of its own, but the
 * app's chord state machine lives in the global handler, and half-implementing a
 * second one inside the editor would give the same chord two owners. A user who
 * rebinds an editor command to a chord loses that command's key rather than
 * getting a subtly different one - and the row still says so in Settings.
 */
export function buildEditorKeyBindings(
  bindings: readonly ParsedShortcutBinding[] = DEFAULT_BINDINGS,
): EditorKeyBinding[] {
  const result: EditorKeyBinding[] = [];
  for (const binding of bindings) {
    const action = EDITOR_KEY_ACTIONS[binding.action];
    if (!action) {
      continue;
    }
    if (binding.parsedChord.length !== 1) {
      continue;
    }
    const key = comboStringToCodeMirrorKey(binding.combo);
    if (key === null) {
      continue;
    }
    result.push({ action, key });
  }
  return result;
}

/** The live editor keymap, including whatever the user has rebound. */
export function useEditorKeyBindings(): EditorKeyBinding[] {
  const { overrides } = useKeyboardShortcutOverrides();
  return useMemo(() => buildEditorKeyBindings(buildEffectiveBindings(overrides)), [overrides]);
}
