---
id: "interactive-state-colors-use-one-theme-accent-ladder"
kind: "requirement"
title: "Interactive state colors use one theme-accent ladder"
status: "confirmed"
tags: ["theme","interaction-state","hover","selection","controls","design-system"]
created_at: "2026-08-21T16:35:51.834Z"
updated_at: "2026-08-21T17:09:01.711Z"
---
# Interactive state colors use one theme-accent ladder

<!-- compiled_truth -->

All interactive UI families use one theme-derived semantic state ladder: `surfaceInteractiveSelected` for quiet persistent selection or open state, `surfaceInteractiveHover` for a more visible transient hover, and `surfaceInteractivePressed` for the strongest press state. These colors are translucent washes of the active theme accent so they preserve each component's resting surface while remaining consistent across title-bar toggles, explorer tabs, sidebar and workspace rows, buttons, split buttons, dropdown and combobox items, segmented controls, and fields. Resting control borders use `borderAccent`. Standalone outlined controls and fields may use the accent-tinted `borderInteractiveHover` on hover, while a compound split-button frame remains on `borderAccent` during segment hover so one segment cannot fracture the shared outline. Focus/open uses solid `accent`; disabled state is opacity-only. Rest surfaces remain context-owned, but component families must not author independent hover, selected, pressed, or interactive-border colors. A non-interactive overlay or action tray that must cover row content uses the precomposited equivalent of the row state so it does not appear as another box. The actual nested action controls remain independently interactive and retain canonical selected/open, hover, and pressed chrome above the row.

## Timeline

- time: "2026-08-21T16:35:51.834Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["primary-sidebars-use-a-deeper-surface-than-tab-rails","daylight-outlined-controls-match-structural-borders","keyboard-focus-rings-hug-control-borders"]
- time: "2026-08-21T16:35:51.834Z"
  kind: "evidence"
  summary: "The user explicitly rejected element-by-element fixes and required the title-bar toggles, explorer tabs, workspace hover/selection, dropdowns, split buttons, buttons, and fields to use the same color paradigm at the UI-system level. The implementation adds canonical tokens in `packages/app/src/styles/theme-palettes.ts`, aliases legacy state names to them, and wires the shared UI primitives and representative row/tab/toggle consumers to the canonical ladder. App typecheck, targeted lint, and focused palette/control-geometry tests pass; rendered browser verification was unavailable because no browser surface was connected."
- time: "2026-08-21T16:50:29.409Z"
  kind: "evidence"
  summary: "The theme-audit UI exposed a missed consumer: `packages/app/src/git/changes-toolbar/toolbar.tsx` painted hover and press with Daylight's opaque elevation surface `surface2` (`#f4f1ec`), while gutter/title toggles used the canonical accent-derived ladder. The shared `ToolbarIconButton` primitive also still used `surface2` for selection and collapsed hover/press together. Added `useToolbarIconButtonStyle` as the shared toolbar-control state resolver, migrated both the primitive and the Changes pinned/menu triggers to it, and separated selected, hover, pressed, focused, and disabled precedence. App typecheck, targeted lint, formatting, and `git diff --check` passed."
  source: "Changes toolbar screenshot and code audit on 2026-08-21"
  affects: ["theme-aware-ui-state-gallery"]
- time: "2026-08-21T16:52:27.959Z"
  kind: "evidence"
  summary: "The audit UI showed that project rows still stacked interaction chrome even after workspace-row correction. `ProjectRowTrailingActions` painted `surfaceInteractiveHover` over an already-hovered project row, while the nested New Workspace and kebab triggers applied another hover wash. The project floating tray now uses `surfaceSidebarPanelInteractiveHoverOpaque`, the precomposited equivalent of the row state, and nested project/workspace row action triggers retain icon-tint feedback without independent background fills. This leaves the row as the sole chrome owner. App typecheck, targeted lint, formatting, `git diff --check`, and `sidebar-workspace-list.test.tsx` (4 tests) passed."
  source: "Project-row double-chrome screenshots and implementation audit on 2026-08-21"
  affects: ["theme-aware-ui-state-gallery"]
- time: "2026-08-21T17:02:14.645Z"
  kind: "decision"
  summary: "The prior wording incorrectly implied that nested row actions should lose their own chrome. The user clarified that only non-interactive covering trays must disappear into the row; actual `+` and kebab buttons still require visible hover, pressed, and open feedback."
  source: "User correction during theme-audit review on 2026-08-21"
  affects: ["theme-aware-ui-state-gallery","primary-sidebars-use-a-deeper-surface-than-tab-rails"]
- time: "2026-08-21T17:02:21.126Z"
  kind: "evidence"
  summary: "Restored canonical selected/open, hover, and pressed background chrome to project kebabs, New Workspace buttons, and workspace kebabs. The project action tray remains on the opaque precomposited row-hover surface, so its covering geometry disappears into the row while each actual control still highlights independently. App typecheck, targeted lint, formatting, `git diff --check`, and `sidebar-workspace-list.test.tsx` (4 tests) passed."
  source: "Nested project/workspace action correction verified on 2026-08-21"
  affects: ["theme-aware-ui-state-gallery"]
- time: "2026-08-21T17:08:48.262Z"
  kind: "decision"
  summary: "The user identified that applying the generic hover-border token independently to a split-button segment fractures the compound frame and makes equivalent Scripts, Open With, and Git Actions controls disagree. Compound controls need stable shared outlines during hover."
  source: "User split-button audit feedback on 2026-08-21"
  affects: ["theme-aware-ui-state-gallery","daylight-outlined-controls-match-structural-borders"]
- time: "2026-08-21T17:09:01.711Z"
  kind: "evidence"
  summary: "Removed `borderInteractiveHover` from the shared split-button segment hover style. Scripts, Open With, and Git Actions now keep the same stable `borderAccent` frame while hover is communicated by `surfaceInteractiveHover`; open/focus can still promote the relevant border to `accent`. Formatting, targeted lint, and `git diff --check` passed. The app typecheck was attempted but was blocked by unrelated concurrent errors in `packages/app/src/components/file-pane.tsx` for undefined `normalizedFilePath` and `attachmentScopeKey`; the split-button files produced no reported errors."
  source: "Split-button hover-frame correction on 2026-08-21"
  affects: ["theme-aware-ui-state-gallery"]
