---
id: "sidebar-navigation-shortcuts-use-two-columns"
kind: "requirement"
title: "Sidebar navigation shortcuts use two columns"
status: "confirmed"
tags: ["ui","sidebar","mobile","android","workspaces","layout"]
created_at: "2026-08-21T15:02:58.385Z"
updated_at: "2026-08-21T15:12:35.175Z"
---
# Sidebar navigation shortcuts use two columns

<!-- compiled_truth -->

The sidebar keeps History as a full-width primary shortcut. Artifacts, Orchestrations, Schedules, and Kanban are arranged in two columns on desktop and the compact mobile sidebar. The top-menu New workspace shortcut is hidden. Each shortcut retains a full compact-row touch target; labels stay single-line and truncate rather than overflow on narrow phone widths. This returns vertical space to the Workspaces list.

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
