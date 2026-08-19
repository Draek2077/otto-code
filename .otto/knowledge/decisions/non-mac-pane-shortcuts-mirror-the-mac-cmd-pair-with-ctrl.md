---
id: "non-mac-pane-shortcuts-mirror-the-mac-cmd-pair-with-ctrl"
kind: "decision"
title: "Non-Mac pane shortcuts mirror the Mac Cmd pair with Ctrl"
status: "proposed"
tags: ["keyboard-shortcuts","panes","non-mac","discoverability"]
created_at: "2026-08-19T01:28:25.905Z"
updated_at: "2026-08-19T01:28:25.905Z"
---
# Non-Mac pane shortcuts mirror the Mac Cmd pair with Ctrl

<!-- compiled_truth -->

All 11 `workspace.pane.*` shortcuts (split.right, split.down, focus x4, move-tab x4, close) get `mac: false` bindings in `packages/app/src/keyboard/keyboard-shortcuts.ts` mirroring the Mac pair: `Ctrl+\` (split right), `Ctrl+Shift+\` (split down), `Ctrl+Shift+Arrow*` (focus, with `editable: false`), `Ctrl+Alt+Shift+Arrow*` (move-tab), `Ctrl+Shift+W` (close pane), all with `when: { mac: false, commandCenter: false, terminal: false }` and the same `help` objects as the Mac bindings (so help rows + `useShortcutKeys` hints appear on non-Mac automatically). Mac bindings stay unchanged. Split label strings ("Split pane right"/"Split pane down") are NOT changed — direction wording is already unambiguous and a rename would ripple into 7 locales + e2e locators; that stays an optional follow-up. Full decision doc: docs/decisions/pane-shortcuts-non-mac-decision.md.

## Timeline

- time: "2026-08-19T01:28:25.905Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-19T01:28:25.905Z"
  kind: "evidence"
  summary: "Verified in keyboard-shortcuts.ts: pane section (lines ~628-756) had only mac:true bindings; every other mac/non-mac pair in the file uses Ctrl+... with mac:false + commandCenter:false + terminal:false; getBindingIdForAction/getDefaultKeysForAction gate on helpMatchesPlatform (mac/desktop only) and dedupe by help.id, so reusing the Mac help objects is the established pattern; e2e locators use accessibilityLabel text and testIDs, unaffected by adding bindings."
