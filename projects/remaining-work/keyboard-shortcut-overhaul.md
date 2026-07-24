# Keyboard shortcut overhaul — "File Editor" scope that overrides Otto's

Plan for bug-batch-2026-07-24 #8. Goal: shortcuts that are **dev-friendly**, and
a first-class **File Editor** section of editor shortcuts that are customizable
in Settings and **override** the general Otto shortcuts _while the editor is
focused_ — the user's framing: "duplicates here… these OVERRIDE them ultimately,
when you are in the editor."

## Where we are today

Two shortcut systems coexist and don't know about each other:

1. **App registry** — `packages/app/src/keyboard/keyboard-shortcuts.ts`.
   - `SHORTCUT_BINDINGS`: id, action, combo, `when` guard, help (section/label/keys).
   - Sections today: `navigation | tabs-panes | projects | panels | agent-input`.
   - User overrides are keyed by **binding id** (`buildEffectiveBindings`), listed
     and re-bindable in the shortcuts settings screen.
   - `when` supports `mac`, `desktop`, `editable: false` (disable while a text
     surface is focused), `terminal: false`, `commandCenter: false`, and
     `focusScope` (exact scope match).
   - Matcher `resolveInitialChordStep` takes the **first** matching single-combo
     binding (`if (!singleComboMatch) singleComboMatch = …`).
2. **CodeMirror's own keymap** — `packages/app/src/editor/editor-core.ts:358`.
   - `Mod-s` → `onSaveShortcut`, `Mod-f` → `onFindShortcut`, `Mod-g` →
     `onGoToLineShortcut`, plus `defaultKeymap`, `historyKeymap`, `indentWithTab`.
   - **Not** in the registry: not listed in Settings, not customizable, not
     overridable, invisible to the conflict story.

`focus-scope.ts` already resolves `"editable"` when the focused element is
`contentEditable`/`input`/`textarea` (the CM6 `.cm-content` is contentEditable →
scope `"editable"`).

### The user's model (clarified 2026-07-24)

> Non-overlapping Otto shortcuts still work in the editor. Only the ones that
> **overlap** an editor shortcut yield to the editor while it's focused.

Not a full modal takeover — a per-combo override. The editor's shortcuts win on
collision; everything else Otto keeps working.

### Interim mechanism (shipped this batch)

Each general Otto binding that overlaps an editor shortcut carries `editable:
false`, so CM6's own keymap handles that combo while a text surface is focused:

- `sidebar.open.search` **Cmd/Ctrl+S** → editor **Save** (`Mod-s`).
- `sidebar.open.files` **Cmd/Ctrl+F** → editor **Find** (`Mod-f`).
- Go-to-line (`Mod-g`) has no Otto global to collide with.
  These are the only overlaps in today's editor shortcut set. The registry-driven
  design below generalizes this so new editor shortcuts get the override for free
  instead of hand-guarding each colliding global.

## Target design

### 1. A "File Editor" section

- Add `"editor"` to `ShortcutSectionId` and to the section title / labelKey maps
  and `sectionOrder`. Label: **"File Editor"**. i18n:
  `settings.shortcuts.sections.editor`.

### 2. First-class editor actions in the registry

New `KeyboardActionId`s (in `keyboard/actions.ts`), each dispatched to the
**focused editor**:

- `editor.save` (Mod+S), `editor.find` (Mod+F), `editor.replace` (Mod+Alt+F or
  Mod+H per platform), `editor.goToLine` (Mod+G), `editor.wordWrap.toggle`,
  `editor.outline` (when `features.codeIndex`), and later `editor.explainSelection`
  (batch #5) and `editor.goToDefinition` (todos/editor-go-to-definition).
- Each carries `when: { focusScope: "editable" }` so it only matches while an
  editor/editable surface is focused.

### 3. Editor bindings OVERRIDE general ones (the core mechanic)

Today two bindings on the same combo → the first wins. Introduce **specificity**:
a binding whose `when.focusScope` matches the current scope beats a binding with
no `focusScope`. Change `resolveInitialChordStep` (and the chord path) to, among
all `matchesCombo && matchesWhen` candidates, pick the **most specific**:

```
focusScope-exact-match  >  editable-guarded (editable:false yields here)  >  general
```

So while editing, `editor.save` (focusScope "editable") beats any general binding
on Mod+S automatically — no need to sprinkle `editable:false` across every general
binding. (The acute Cmd+S guard becomes redundant once `editor.save` ships; keep
it until then, then remove — mark `COMPAT(editorSaveShortcut)`.)

### 4. Registry → CodeMirror bridge (two options)

**MVP (smaller):** registry stays the source of truth for the _combos_; CM6
stays the _executor_. `code-editor` reads the effective editor-section bindings
and builds its CM6 keymap from them (mapping each editor action id → the existing
`onSaveShortcut`/`onFindShortcut`/… callbacks) instead of hardcoding Mod-s/f/g.
User overrides then flow into CM6. The global handler yields to CM6 because the
editor bindings are focusScope-scoped (§3) and CM6 `preventDefault`s.

**Full (right end-state):** remove the CM6 keymap for these; register the focused
editor controller in a small store (`focused-editor-store`), and have the global
keyboard hook dispatch `editor.*` actions to it. One system, one source of truth,
one conflict story. More work (controller registry + dispatch wiring), do it once
the MVP proves the section.

Recommendation: ship **MVP** first (unblocks customization + the section), then
converge to **Full** alongside batch #5's explain-selection (which already needs
a focused-controller dispatch path).

### 5. Settings UI

- The shortcuts settings screen already renders sections from
  `buildKeyboardShortcutHelpSections`; the new `"editor"` section appears for free
  once bindings carry `help.section: "editor"`.
- **Conflict UX:** an editor binding _intentionally_ shares a combo with a general
  one (that IS the override). The conflict detector must treat bindings in
  different scopes as non-conflicting — only flag same-scope collisions.

### 6. Broader dev-friendliness audit

Reconsider defaults a dev finds surprising (capture in follow-up commits):

- `Cmd/Ctrl+S` = "open search sidebar" → now guarded; long-term it should just be
  Save globally-ish, with search on `Cmd+Shift+F` (already bound).
- `Cmd/Ctrl+F` = "open files sidebar" while the editor's find is CM6-internal
  `Mod-f` — with the editor section, `editor.find` on Mod+F overrides cleanly.
- Audit `Cmd+G`, `Cmd+E`, `Cmd+H` for editor-context surprises.

## Sequencing

1. Add `"editor"` section + editor `KeyboardActionId`s + bindings (help only, no
   dispatch yet) — visible in Settings.
2. Add specificity to the matcher (§3) + tests in `keyboard-shortcuts.test.ts`.
3. MVP bridge (§4) — CM6 keymap sourced from registry; remove the acute Cmd+S
   `editable:false` guard.
4. Conflict-UX scope awareness (§5).
5. Converge to Full dispatch (§4) with batch #5.
6. Dev-friendliness audit pass (§6).

## Tests

- `keyboard-shortcuts.test.ts`: specificity (editor binding beats general while
  editable; general still wins when not editable), section presence, override.
- `focus-scope.test.ts`: already covers `.cm-content` → `"editable"`; add a case
  asserting an editor binding matches only in that scope.
