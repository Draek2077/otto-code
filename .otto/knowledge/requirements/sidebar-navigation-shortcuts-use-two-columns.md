---
id: "sidebar-navigation-shortcuts-use-two-columns"
kind: "requirement"
title: "Sidebar navigation shortcuts use two columns"
status: "confirmed"
tags: ["ui","sidebar","mobile","android","workspaces","layout"]
created_at: "2026-08-21T15:02:58.385Z"
updated_at: "2026-08-22T15:04:36.348Z"
---
# Sidebar navigation shortcuts use two columns

<!-- compiled_truth -->

The sidebar's top navigation shortcut grid contains Artifacts, Kanban, Schedules, and Workflows in an explicit two-column maximum on desktop and the compact mobile sidebar. Workflows is a sidebar-only temporary display label; the wider product terminology remains unchanged. When the available sidebar width cannot support two compact rows, the four shortcuts collapse to one column and restore the top controls' left alignment. Each shortcut retains a full compact-row touch target; labels wrap rather than truncate with an ellipsis. The top-menu New workspace shortcut is hidden. History is instead an icon-only action in the Workspaces header immediately after New Project, using the History icon, localized label and tooltip, existing navigation behavior and test identifier, plus an active-state surface. This returns vertical space to the Workspaces list.

## Timeline

- time: "2026-08-21T15:02:58.385Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T15:02:58.385Z"
  kind: "evidence"
  summary: "User requirement, 2026-08-21: “In the top left menu for history, artifacts, orchestration, etc those could potentially fit as two columns, giving height back to workspaces.” Follow-up: “I would like it to work for at least my android phone profile.” Implemented in packages/app/src/components/left-sidebar.tsx and packages/app/src/components/sidebar/sidebar-header-row.tsx; targeted lint and app typecheck passed."
- time: "2026-08-21T15:11:55.722Z"
  kind: "decision"
  summary: "User refined the sidebar layout: History is the full-width entry and New workspace is hidden from this menu."
- time: "2026-08-21T15:12:35.175Z"
  kind: "decision"
  summary: "Corrected the entry-point rationale: the requirement is to hide this specific top-menu New workspace shortcut, without asserting an alternate control."
- time: "2026-08-21T15:26:47.800Z"
  kind: "decision"
  summary: "User clarified that the menu must never use more than two columns and must collapse to one column when its available width cannot support two compact rows."
  source: "User requirement, 2026-08-21"
- time: "2026-08-21T15:33:52.877Z"
  kind: "decision"
  summary: "User clarified that narrow one-column layout restores the top controls' left alignment and that navigation labels must not display ellipses."
  source: "User requirement, 2026-08-21"
- time: "2026-08-21T15:34:57.896Z"
  kind: "decision"
  summary: "User requested a sidebar-only temporary label of Workflows and alphabetical ordering below History, while deferring the product-wide terminology migration."
  source: "User requirement, 2026-08-21"
- time: "2026-08-21T22:02:07.275Z"
  kind: "evidence"
  summary: "User refinement, 2026-08-21: the top-left sidebar navigation uses a consistent 4px rhythm between the team picker and History, between navigation rows, and between the two columns. Implemented with theme.spacing[1] gaps on the navigation header/grid/rows; the previous split side paddings were removed so the column gap is exactly 4px."
  source: "packages/app/src/components/left-sidebar.tsx"
- time: "2026-08-22T15:04:36.348Z"
  kind: "decision"
  summary: "User requested on 2026-08-22 that History move from the top-left navigation menu into the Workspaces action series after New Project. Implemented and verified in packages/app/src/components/left-sidebar.tsx with targeted formatting, lint, and app typecheck passing."
  source: "User request, 2026-08-22; packages/app/src/components/left-sidebar.tsx"
