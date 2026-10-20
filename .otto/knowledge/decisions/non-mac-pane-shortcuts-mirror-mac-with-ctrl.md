---
id: "non-mac-pane-shortcuts-mirror-mac-with-ctrl"
kind: "decision"
title: "Non-Mac pane shortcuts mirror the Mac chords with Ctrl, and pane labels keep direction wording"
status: "proposed"
tags: ["keyboard-shortcuts","panes","windows","linux","discoverability","partially-implemented"]
created_at: "2026-08-23T03:22:09.732Z"
updated_at: "2026-08-23T03:22:09.732Z"
---
# Non-Mac pane shortcuts mirror the Mac chords with Ctrl, and pane labels keep direction wording

<!-- compiled_truth -->

Pane management shortcuts get a non-Mac counterpart that mirrors the Mac chord exactly, swapping `Cmd` for `Ctrl`, reusing the Mac binding's `help` object so the rendered chord stays platform-correct through `"mod"`. Pane action labels keep their direction wording and do not gain "(vertical)"/"(horizontal)" suffixes.

**The gap this closed.** The pane section held 11 bindings, all `when: { mac: true }` with no counterpart. `getBindingIdForAction` and `getDefaultKeysForAction` therefore returned `null` on Windows and Linux for all 11 actions, so `useShortcutKeys` returned `null`, the `SplitActionButton` tooltip showed no chord, `ShortcutDiscoveryHint` had nothing to reveal, and `buildKeyboardShortcutHelpSections` emitted no `tabs-panes` rows off Mac. Windows and Linux users had no discoverable keyboard path to split, navigate, move, or close panes.

**Why `Ctrl`.** Every existing non-Mac pair in the registry mirrors a Mac `Cmd+…` with `Ctrl+…` (`Ctrl+W`, `Ctrl+Shift+T`, `Ctrl+[`/`Ctrl+]`). Reusing the Mac `help` object is how every other pair works, because `buildKeyboardShortcutHelpSections` dedupes by `section:help.id` and `helpMatchesPlatform` filters by platform, so no new `SHORTCUT_HELP_LABEL_KEYS` entries are needed. The accepted collision is `Ctrl+Shift+W`, which Chrome and Edge use for "reopen closed tab"; the default `preventDefault` in `buildMatchFromBinding` suppresses it, the same trade the registry already accepts for `Ctrl+W` and `Ctrl+Shift+T`.

**Why labels stay.** "right" and "down" are already unambiguous directions describing where the new pane appears, matching "Focus pane left/right/up/down" in the same help section. Changing them would ripple into `e2e/viewed-agent-timelines.spec.ts` and `e2e/file-editing.spec.ts`, which locate by the exact string, plus 7 translated locales under `resources.test.ts` key-parity and fallback-ceiling enforcement. The actual discoverability complaint is fixed by the bindings alone, without touching a single string.

## Implementation status: 2 of 11, verified 2026-08-22

Only `workspace.pane.split.right` (`Ctrl+\`) and `workspace.pane.split.down` (`Ctrl+Shift+\`) shipped a non-Mac binding. **Nine actions remain Mac-only and are still undiscoverable on Windows and Linux**: `focus.left`, `focus.right`, `focus.up`, `focus.down`, `move-tab.left`, `move-tab.right`, `move-tab.up`, `move-tab.down`, and `pane.close`.

Three drifts from the written spec, all cosmetic rather than behavioural:

- Shipped ids are `workspace-pane-split-right-ctrl-backslash`, not the specified `…-ctrl-backslash-non-mac`.
- Shipped `when` clauses are `{ mac: false, commandCenter: false }` and omit the `terminal: false` guard the decision argued every non-Mac binding carries. Worth resolving when the remaining nine land, because the focus family binds arrow keys.
- The section comment became `// --- Pane management ---` rather than the specified `(mac + non-mac)`.

Decision 2 was honoured: labels are unchanged. Decision 3 landed: `shortcutKeys={splitRightKeys}` and `{splitDownKeys}` are wired into the catalog menu rows in `workspace-desktop-tabs-row.tsx`.

Test state matches the partial implementation. The old negative case "does not bind pane shortcuts on non-mac platforms" is gone, positive `isMac: false` match cases exist for the two shipped splits, and the non-Mac help-section case asserts exactly `workspace-pane-split-right` and `workspace-pane-split-down` and nothing else. The other nine are asserted only under `isMac: true`.

Related: [[contextual-shortcut-discovery]].

## Timeline

- time: "2026-08-23T03:22:09.732Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-23T03:22:09.732Z"
  kind: "evidence"
  summary: "Migrated from `docs/decisions/pane-shortcuts-non-mac-decision.md`, a 164-line record added 2026-08-18 in commit `aa1df013b`. It was moved out of `docs/` during the 2026-08-22 file-hygiene sweep: `docs/` is present-tense \"how Otto works\", while this document is future-tense \"what to build\", which AGENTS.md routes to Knowledge. `docs/decisions/` held this one file and was removed as a fourth documentation location duplicating `.otto/knowledge/decisions/`.\n\nImplementation status verified 2026-08-22 by reading the registry rather than trusting the document. `grep -o 'id: \"workspace-pane-[a-z0-9-]*\"' packages/app/src/keyboard/keyboard-shortcuts.ts` over the whole file yields 11 ids containing `cmd` and 2 containing `ctrl` (`workspace-pane-split-right-ctrl-backslash`, `workspace-pane-split-down-ctrl-shift-backslash`). Both carry `when: { mac: false, commandCenter: false }` with no `terminal: false`. The section header at line 621 reads `// --- Pane management ---`.\n\nTest state read from `packages/app/src/keyboard/keyboard-shortcuts.test.ts`: the string \"does not bind pane shortcuts on non-mac\" returns no match; cases \"matches Ctrl+Backslash to split pane right on non-mac platforms\" and \"matches Ctrl+Shift+Backslash to split pane down on non-mac platforms\" both use `context: { isMac: false }`; the help case \"uses non-mac desktop defaults for tab jump and close tab\" (`{ isMac: false, isDesktop: true }`) expects only `workspace-pane-split-right` and `workspace-pane-split-down`, while `workspace-pane-close` appears solely under `isMac: true` contexts. Decision 3 confirmed at `packages/app/src/screens/workspace/workspace-desktop-tabs-row.tsx:613,623`.\n\nThe original document's full per-binding tables, collision analysis, and implementation checklist remain retrievable at `git show aa1df013b:docs/decisions/pane-shortcuts-non-mac-decision.md`."
