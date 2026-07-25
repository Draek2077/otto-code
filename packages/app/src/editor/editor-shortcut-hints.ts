import type { ShortcutKey } from "@/utils/format-shortcut";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { getShortcutOs } from "@/utils/shortcut-platform";

// What the editor's toolbar and context menu print next to their labels.
//
// Two kinds of hint live here, and the difference is which system owns the key:
//
//  - The REGISTRY rows (save, find, go to line, go to definition) are File
//    Editor bindings, so they are read through `useShortcutKeys` and follow the
//    user's rebinds. That is the whole reason a hint can be trusted: it prints
//    what the registry will actually match, not what someone typed here.
//  - The STATIC rows (cut/copy/paste/select all/select line) are CodeMirror's
//    `defaultKeymap` and the platform's clipboard, which Otto does not bind and
//    the user cannot rebind. Keep them in step with that keymap by hand; adding
//    a row here for something Otto binds would be duplicating the registry, and
//    the registry would win.
//
// Chords throughout (`ShortcutKey[][]`), because a rebind may be one: a hint
// that silently printed only the first step would be the same lie in a new form.
export interface EditorShortcutHints {
  save: ShortcutKey[][];
  find: ShortcutKey[][];
  goToLine: ShortcutKey[][];
  goToDefinition: ShortcutKey[][];
  findReferences: ShortcutKey[][];
  renameSymbol: ShortcutKey[][];
  cut: ShortcutKey[][];
  copy: ShortcutKey[][];
  paste: ShortcutKey[][];
  selectAll: ShortcutKey[][];
  selectLine: ShortcutKey[][];
}

const NO_KEYS: ShortcutKey[][] = [];

export function useEditorShortcutHints(): EditorShortcutHints {
  const isMac = getShortcutOs() === "mac";
  // Help-row ids, not action ids — `useShortcutKeys` resolves a row to the
  // binding serving this platform, which is also what the Settings screen does.
  const save = useShortcutKeys("editor-save");
  const find = useShortcutKeys("editor-find");
  const goToLine = useShortcutKeys("editor-go-to-line");
  const goToDefinition = useShortcutKeys("editor-go-to-definition");
  const findReferences = useShortcutKeys("editor-find-references");
  const renameSymbol = useShortcutKeys("editor-rename-symbol");

  return {
    save: save ?? NO_KEYS,
    find: find ?? NO_KEYS,
    goToLine: goToLine ?? NO_KEYS,
    // The menu leaves F12 unsaid: one hint per row, and Mod+B is the one that
    // survives on a laptop with media keys on the function row.
    goToDefinition: goToDefinition ?? NO_KEYS,
    findReferences: findReferences ?? NO_KEYS,
    renameSymbol: renameSymbol ?? NO_KEYS,
    // Cut/copy/paste are the platform's own clipboard bindings, not ours.
    cut: [["mod", "X"]],
    copy: [["mod", "C"]],
    paste: [["mod", "V"]],
    selectAll: [["mod", "A"]],
    // CodeMirror's own `selectLine`, which is Ctrl-l on macOS and Alt-l
    // elsewhere — the one editor command here that is not Mod-something.
    selectLine: isMac ? [["ctrl", "L"]] : [["alt", "L"]],
  };
}
