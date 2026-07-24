import type { ShortcutKey } from "@/utils/format-shortcut";
import { getShortcutOs } from "@/utils/shortcut-platform";

// What the editor's toolbar and context menu print next to their labels.
//
// These are NOT registry bindings: everything here is bound inside CodeMirror's
// own keymap (editor-core's `keymap.of` plus `defaultKeymap`), which is why
// `useShortcutKeys` cannot resolve them — it only knows the app-wide registry.
// Keep this file in step with that keymap; it is the only reason the hints are
// true. Anything the user can remap belongs in the registry instead, and should
// be read through `useShortcutKeys`.
export interface EditorShortcutHints {
  save: ShortcutKey[];
  find: ShortcutKey[];
  goToLine: ShortcutKey[];
  goToDefinition: ShortcutKey[];
  cut: ShortcutKey[];
  copy: ShortcutKey[];
  paste: ShortcutKey[];
  selectAll: ShortcutKey[];
  selectLine: ShortcutKey[];
}

export function getEditorShortcutHints(): EditorShortcutHints {
  const isMac = getShortcutOs() === "mac";
  return {
    save: ["mod", "S"],
    find: ["mod", "F"],
    goToLine: ["mod", "G"],
    // Also F12, which the menu leaves unsaid: one hint per row, and Mod+B is
    // the one that survives on a laptop with media keys on the function row.
    goToDefinition: ["mod", "B"],
    // Cut/copy/paste are the platform's own clipboard bindings, not ours.
    cut: ["mod", "X"],
    copy: ["mod", "C"],
    paste: ["mod", "V"],
    selectAll: ["mod", "A"],
    // CodeMirror's own `selectLine`, which is Ctrl-l on macOS and Alt-l
    // elsewhere — the one editor command here that is not Mod-something.
    selectLine: isMac ? ["ctrl", "L"] : ["alt", "L"],
  };
}
