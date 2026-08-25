---
id: "workspace-row-icons-align-to-title-line"
kind: "requirement"
title: "Workspace row icons align to the title line"
status: "confirmed"
tags: ["ui","responsive-layout","sidebar","workspaces"]
created_at: "2026-08-11T04:09:13.750Z"
updated_at: "2026-08-25T03:28:21.748Z"
---
# Workspace row icons align to the title line

<!-- compiled_truth -->

In compact workspace rows, leading status/loading indicators and trailing controls must share the project row's responsive geometry and center against the workspace card's complete content stack. Their placement must remain visually balanced as subtitles, PR badges, host labels, and other metadata appear or disappear; they must not be attached to a particular text line.

## Timeline

- time: "2026-08-11T04:09:13.750Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-11T04:09:13.750Z"
  kind: "evidence"
  summary: "User request with mobile workspace sidebar screenshot on 2026-08-10; shared row layout places leading and trailing affordances inside the title-line container."
- time: "2026-08-11T04:39:41.317Z"
  kind: "decision"
  summary: "The user clarified on 2026-08-10 that workspace affordances must adapt to the full variable-height row rather than align to the title line."
  source: "User clarification"
- time: "2026-08-21T22:11:34.182Z"
  kind: "evidence"
  summary: "Aligned Project and Workspace trailing actions with the row geometry: removed the Project action group's negative right margin so `+` and kebab controls remain inside the row's normal inset, and centered the shared Workspace trailing slot with the title row. Targeted app lint, app typecheck, formatting, and `git diff --check` passed."
  source: "Implementation verified on 2026-08-21"
  affects: ["primary-sidebars-use-a-deeper-surface-than-tab-rails"]
- time: "2026-08-21T22:18:28.152Z"
  kind: "evidence"
  summary: "Reduced the expanded project block separator in `packages/app/src/components/sidebar-workspace-list.tsx` from `theme.spacing[3]` (12 px) to `theme.spacing[1]` (4 px), removing the excessive gap between projects while preserving the conditional spacing for collapsed projects. Targeted app lint, app typecheck, the sidebar workspace-list test (4/4), formatting, and `git diff --check` passed."
  source: "Implementation verified on 2026-08-21"
  affects: ["workspace-row-icons-align-to-title-line"]
- time: "2026-08-21T22:21:56.975Z"
  kind: "evidence"
  summary: "Moved the shared workspace trailing action slot out of `workspaceTitleRow` and beside the complete title/metadata column, with the row main container centering all siblings. This keeps kebab and other actions centered as metadata changes the row height. Targeted sidebar workspace-list tests passed 4/4; app lint, typecheck, formatting, and `git diff --check` passed."
  source: "Implementation verified on 2026-08-21"
  affects: ["workspace-row-icons-align-to-title-line"]
- time: "2026-08-21T22:25:37.875Z"
  kind: "evidence"
  summary: "Optically corrected the compact trailing action rails after screenshot review: shared Workspace and Project action groups are lifted by `theme.spacing[0.5]` so their larger touch targets center with the row's status/title content. Targeted sidebar workspace-list tests passed 4/4; app lint, typecheck, formatting, and `git diff --check` passed."
  source: "Implementation verified on 2026-08-21"
  affects: ["workspace-row-icons-align-to-title-line"]
- time: "2026-08-21T23:33:49.500Z"
  kind: "evidence"
  summary: "Reduced compact project-row vertical padding in `packages/app/src/components/sidebar-workspace-list.tsx` from 8 px to 6 px, bringing the 24 px action target's row from 40 px down to the existing 36 px minimum. Removed the trailing-action rail's upward translation so the plus and kebab controls center geometrically with the shortened row. Focused sidebar workspace-list tests passed 4/4; app lint, typecheck, formatting, and `git diff --check` passed."
  source: "Implementation verified on 2026-08-21"
  affects: ["workspace-row-icons-align-to-title-line"]
- time: "2026-08-22T19:13:38.072Z"
  kind: "evidence"
  summary: "The row-level 2px lift (`translateY: -theme.spacing[0.5]` on `rowRight` in `sidebar-workspace-row-content.tsx`) was re-scoped to the kebab overlay only after the user reported the trailing diff stat riding above the title line: the lift was meant for the 24px kebab touch target, but it also carried the 20px DiffStat/timestamp. Verified in the running dev app that the diff glyphs now center exactly on the title line box (both centers at the same y) while the kebab keeps its optical lift via `trailingActionOverlay`. Targeted oxlint, app typecheck, and oxfmt passed."
- time: "2026-08-25T03:25:43.059Z"
  kind: "evidence"
  summary: "Reduced the project row's inter-item margin and the expanded project-block separator to 2px via `theme.spacing[0.5]` in `packages/app/src/components/sidebar-workspace-list.tsx`, matching the existing workspace-row spacing. Targeted app lint, app typecheck, formatting, and `git diff --check` passed."
  source: "Implementation verified on 2026-08-24"
  affects: ["workspace-row-icons-align-to-title-line"]
- time: "2026-08-25T03:28:21.748Z"
  kind: "evidence"
  summary: "Follow-up spacing correction: the expanded project block's padding is now 0 because the final workspace row already supplies the 2px bottom margin. This keeps the visible gap from the bottom of a workspace list to the next project at 2px rather than doubling to 4px. Targeted app lint, app typecheck, formatting, and `git diff --check` passed."
  source: "Implementation verified on 2026-08-25"
  affects: ["workspace-row-icons-align-to-title-line"]
