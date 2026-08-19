# Decision: non-Mac pane shortcuts + split label wording

**Status:** Decision finalized (investigation pass — no implementation in this pass)
**Primary file:** `packages/app/src/keyboard/keyboard-shortcuts.ts` (pane section, lines ~628–756)

## Gap (verified)

The `// --- Pane management (mac only) ---` section has exactly 11 bindings, all
`when: { mac: true, ... }` with no `mac: false` counterpart:

| #   | Binding id (existing, Mac)                          | Action                          | Mac combo                  |
| --- | --------------------------------------------------- | ------------------------------- | -------------------------- |
| 1   | `workspace-pane-split-right-cmd-backslash`          | `workspace.pane.split.right`    | `Cmd+\`                    |
| 2   | `workspace-pane-split-down-cmd-shift-backslash`     | `workspace.pane.split.down`     | `Cmd+Shift+\`              |
| 3   | `workspace-pane-focus-left-cmd-shift-left`          | `workspace.pane.focus.left`     | `Cmd+Shift+ArrowLeft`      |
| 4   | `workspace-pane-focus-right-cmd-shift-right`        | `workspace.pane.focus.right`    | `Cmd+Shift+ArrowRight`     |
| 5   | `workspace-pane-focus-up-cmd-shift-up`              | `workspace.pane.focus.up`       | `Cmd+Shift+ArrowUp`        |
| 6   | `workspace-pane-focus-down-cmd-shift-down`          | `workspace.pane.focus.down`     | `Cmd+Shift+ArrowDown`      |
| 7   | `workspace-pane-move-tab-left-cmd-shift-alt-left`   | `workspace.pane.move-tab.left`  | `Cmd+Alt+Shift+ArrowLeft`  |
| 8   | `workspace-pane-move-tab-right-cmd-shift-alt-right` | `workspace.pane.move-tab.right` | `Cmd+Alt+Shift+ArrowRight` |
| 9   | `workspace-pane-move-tab-up-cmd-shift-alt-up`       | `workspace.pane.move-tab.up`    | `Cmd+Alt+Shift+ArrowUp`    |
| 10  | `workspace-pane-move-tab-down-cmd-shift-alt-down`   | `workspace.pane.move-tab.down`  | `Cmd+Alt+Shift+ArrowDown`  |
| 11  | `workspace-pane-close-cmd-shift-w`                  | `workspace.pane.close`          | `Cmd+Shift+W`              |

Consequence (mechanism verified): `getBindingIdForAction` / `getDefaultKeysForAction`
(keyboard-shortcuts.ts:1954/1970) return `null` on non-Mac for all 11 actions →
`useShortcutKeys` returns `null` → `SplitActionButton` tooltip shows no `Shortcut`
chord and `ShortcutDiscoveryHint` has nothing to reveal →
`buildKeyboardShortcutHelpSections` (gated by `helpMatchesPlatform`, which only
checks `mac`/`desktop`) emits no `tabs-panes` pane rows on Windows/Linux. So
Windows/Linux users have **no discoverable keyboard path** to split/navigate/move/close
panes at all.

## Decision 1 — Non-Mac bindings

**Mirror the Mac pair exactly**, using the file's established non-Mac pattern:
`combo: "Ctrl+..."` with `when: { mac: false, commandCenter: false, terminal: false }`,
and the same `help` object (same `help.id`, section, label, and `keys` — `keys` uses
`"mod"` so the rendered chord is platform-correct: `Ctrl+\` / `Ctrl+Shift+\` on
non-Mac via `formatShortcut`'s `mod → "Ctrl"` mapping).

New bindings (to be inserted immediately after each Mac binding, matching the file's
adjacent-pair style like `workspace-tab-close-current-cmd-w` /
`...-ctrl-w-non-mac`):

| Action                          | New binding id                                               | combo                       | `when`                                                                   | help.keys                          |
| ------------------------------- | ------------------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------ | ---------------------------------- |
| `workspace.pane.split.right`    | `workspace-pane-split-right-ctrl-backslash-non-mac`          | `Ctrl+\`                    | `{ mac: false, commandCenter: false, terminal: false }`                  | `["mod", "\\"]`                    |
| `workspace.pane.split.down`     | `workspace-pane-split-down-ctrl-shift-backslash-non-mac`     | `Ctrl+Shift+\`              | `{ mac: false, commandCenter: false, terminal: false }`                  | `["mod", "shift", "\\"]`           |
| `workspace.pane.focus.left`     | `workspace-pane-focus-left-ctrl-shift-left-non-mac`          | `Ctrl+Shift+ArrowLeft`      | `{ mac: false, commandCenter: false, terminal: false, editable: false }` | `["mod", "shift", "Left"]`         |
| `workspace.pane.focus.right`    | `workspace-pane-focus-right-ctrl-shift-right-non-mac`        | `Ctrl+Shift+ArrowRight`     | `{ mac: false, commandCenter: false, terminal: false, editable: false }` | `["mod", "shift", "Right"]`        |
| `workspace.pane.focus.up`       | `workspace-pane-focus-up-ctrl-shift-up-non-mac`              | `Ctrl+Shift+ArrowUp`        | `{ mac: false, commandCenter: false, terminal: false, editable: false }` | `["mod", "shift", "Up"]`           |
| `workspace.pane.focus.down`     | `workspace-pane-focus-down-ctrl-shift-down-non-mac`          | `Ctrl+Shift+ArrowDown`      | `{ mac: false, commandCenter: false, terminal: false, editable: false }` | `["mod", "shift", "Down"]`         |
| `workspace.pane.move-tab.left`  | `workspace-pane-move-tab-left-ctrl-shift-alt-left-non-mac`   | `Ctrl+Alt+Shift+ArrowLeft`  | `{ mac: false, commandCenter: false, terminal: false }`                  | `["mod", "shift", "alt", "Left"]`  |
| `workspace.pane.move-tab.right` | `workspace-pane-move-tab-right-ctrl-shift-alt-right-non-mac` | `Ctrl+Alt+Shift+ArrowRight` | `{ mac: false, commandCenter: false, terminal: false }`                  | `["mod", "shift", "alt", "Right"]` |
| `workspace.pane.move-tab.up`    | `workspace-pane-move-tab-up-ctrl-shift-alt-up-non-mac`       | `Ctrl+Alt+Shift+ArrowUp`    | `{ mac: false, commandCenter: false, terminal: false }`                  | `["mod", "shift", "alt", "Up"]`    |
| `workspace.pane.move-tab.down`  | `workspace-pane-move-tab-down-ctrl-shift-alt-down-non-mac`   | `Ctrl+Alt+Shift+ArrowDown`  | `{ mac: false, commandCenter: false, terminal: false }`                  | `["mod", "shift", "alt", "Down"]`  |
| `workspace.pane.close`          | `workspace-pane-close-ctrl-shift-w-non-mac`                  | `Ctrl+Shift+W`              | `{ mac: false, commandCenter: false, terminal: false }`                  | `["mod", "shift", "W"]`            |

Rationale for each choice:

- **`Ctrl` (not `Alt`/`Shift`)** — every existing non-Mac pair in the file uses
  `Ctrl+...` as the mirror of the Mac `Cmd+...` pair (e.g. `Ctrl+W`, `Ctrl+Shift+T`,
  `Ctrl+[`/`Ctrl+]`, `Ctrl+Alt+F`/`Ctrl+Alt+T`).
- **`when` shape** — `mac: false` + `commandCenter: false` mirrors the Mac side 1:1.
  `terminal: false` is added because **every** other non-Mac binding in the file
  carries it (the guard for xterm focus). The focus family keeps `editable: false`
  exactly as on the Mac side (arrow navigation must not eat text-selection keys in
  editable surfaces). **No `desktop: true`**: the Mac bindings have no desktop
  constraint, so the mirror works on web too — consistent with the Mac behavior.
- **Same `help` object per action** — `buildKeyboardShortcutHelpSections` dedupes by
  `section:help.id` and `helpMatchesPlatform` filters by platform, so reusing the
  Mac binding's `help` (with `"mod"` keys) is exactly how every other mac/non-mac
  pair in the file works. No new `SHORTCUT_HELP_LABEL_KEYS` entries are needed.
- **Collision check (verified by grep over the whole file + e2e)**:
  - `Ctrl+\`, `Ctrl+Shift+\`, `Ctrl+Shift+W`, `Ctrl+Alt+Shift+Arrows`: no other
    binding in `SHORTCUT_BINDINGS` uses these combos on non-Mac.
  - `Ctrl+Shift+Arrows`: the only existing consumers of `Ctrl+Shift+Arrow*` on
    non-Mac are browser-level (nothing in the registry); the existing test
    `"keeps Cmd+Shift+ArrowRight available for message input selection"` is
    **Mac-only** (`metaKey`), so no conflict.
  - `Ctrl+Shift+W` in Chrome/Edge is "reopen closed tab" — the app's `preventDefault`
    (default `true` in `buildMatchFromBinding`) suppresses it while the shortcut is
    active; acceptable trade-off, same class of overlap the file already accepts
    (e.g. `Ctrl+W` close tab, `Ctrl+Shift+T` new terminal vs. browser "reopen tab").
  - `Ctrl+Alt+Shift+Arrows` are Windows accessibility key navigation chords only when
    activated by Win+arrow first — no practical conflict in-app.
- **`Ctrl+Shift+\` is NOT a browser/Electron default** on Windows/Linux (unlike
  `Ctrl+\` which some Linux terminal emulators use for SIGQUIT — irrelevant in-app
  since `terminal: false` keeps the embedded terminal safe).

## Decision 2 — Label wording

**Keep the existing label strings; do NOT add "(vertical)"/"(horizontal)" suffixes.**

- Existing strings: `workspace.tabs.actions.splitRight` = "Split pane right",
  `splitDown` = "Split pane down" (en.ts:966–967, used by the catalog dropdown rows
  AND the two `SplitActionButton` tooltips, workspace-desktop-tabs-row.tsx:1113/1120/
  1238/1248); help rows use `settings.shortcuts.help.splitPaneRight/splitPaneDown`
  (en.ts:3468–3469, same wording).
- The direction words ("right"/"down") are already unambiguous _directions_ — they
  describe where the new pane appears, which is the same convention as "Focus pane
  left/right/up/down" and "Move tab left/…" in the same help section. The
  vertical/horizontal distinction is a property of the _split axis_, and every
  competing convention in the file already uses direction words.
- **Why not change at all in this pass:** the label change would ripple into
  `e2e/viewed-agent-timelines.spec.ts:132` (live test, exact `getByRole("button",
{ name: "Split pane right" })` against the tooltip `accessibilityLabel`),
  `e2e/file-editing.spec.ts:188` (skipped, same locator), and 7 locale files
  (ar/es/fr/ja/pt-BR/ru/zh-CN — all currently translated; `resources.test.ts`
  enforces exact key parity and an 8% fallback-string ceiling, so every changed
  string must be re-translated in 7 languages). That is a larger, separate change.
- **Discovered-surface improvement that DOES fix the actual discoverability
  complaint without string changes:** `Ctrl+\` on non-Mac (and `Cmd+\` on Mac) is now
  _visible_ in the `SplitActionButton` tooltip via the existing
  `<Shortcut chord={shortcutKeys}/>` and in `ShortcutDiscoveryHint` (modifier-hold
  discovery) as soon as Decision 1 lands — `useShortcutKeys` will return non-null.
  The shifted-`\` miss on Mac is solved by the same mechanism: holding
  `Cmd+Shift` now reveals `|`→split-down (discovery derives from the same binding
  registry per the `contextual-shortcut-discovery` requirement).
- Optional follow-up (separate pass, if the label change is still wanted): update
  `en.ts` 966–967 + 3468–3469 to "Split pane right (vertical split)" /
  "Split pane down (horizontal split)", mirror into the 7 locales, update
  `keyboard-shortcuts.ts:635/647` literal labels + the two e2e locators. NOT part of
  this decision's scope.

## Decision 3 — Catalog menu shortcut hints (optional, low risk)

`PinnableMenuItem` split rows (workspace-desktop-tabs-row.tsx:1111/1118) currently
show no shortcut hint. After Decision 1, `useShortcutKeys("workspace.pane.split.right")`
returns keys on every platform. Adding a `Shortcut chord` to those two rows is a
small, contained enhancement — **decision: include it in the implementation pass**
(consistency: every other pinned tool row that has a binding shows its chord).
`PinnableMenuItem` needs a prop check for an existing shortcut slot before
implementing; if none exists, leave the rows as-is (the tooltip on the strip
buttons already carries the chord) and note it as follow-up.

## Files to touch in the implementation pass

1. `packages/app/src/keyboard/keyboard-shortcuts.ts` — add the 11 `mac: false`
   bindings after their Mac counterparts; update the section comment from
   `(mac only)` to `(mac + non-mac)`; **no** `SHORTCUT_HELP_LABEL_KEYS` changes.
2. `packages/app/src/keyboard/keyboard-shortcuts.test.ts` —
   - Replace the negative case `"does not bind pane shortcuts on non-mac platforms"`
     (`Ctrl+\` on non-Mac currently expects no match) with positive cases:
     `Ctrl+\` → `workspace.pane.split.right`, `Ctrl+Shift+\` → `workspace.pane.split.down`,
     `Ctrl+Shift+ArrowRight` → focus.right, `Ctrl+Alt+Shift+ArrowDown` → move-tab.down,
     `Ctrl+Shift+W` → close (all with `context: { isMac: false, isDesktop: true }`).
   - Extend the help-section case `"uses non-mac desktop defaults for tab jump and close tab"`
     (`context: { isMac: false, isDesktop: true }`) with
     `"workspace-pane-split-right": ["mod", "\\"]`, `"workspace-pane-close": ["mod", "shift", "W"]`
     (rows now appear on non-Mac; keys render as `Ctrl+\` / `Ctrl+Shift+W` via
     `formatShortcut`).
   - Keep the two existing Mac positive cases unchanged.
3. `packages/app/e2e/` — **no changes required** (labels unchanged; locators by
   `accessibilityLabel`/testID are untouched).
4. i18n resources — **no changes required** in this pass.

## Explicitly NOT changing

- Any Mac binding (combos, `when`, help) — byte-identical.
- i18n strings (all 8 locales).
- `useShortcutKeys`, `shortcut-string.ts`, dispatcher, actions — no changes needed;
  the registry is the single source of truth and all surfaces derive from it.
