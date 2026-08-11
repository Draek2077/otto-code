---
id: "knowledge-and-context-splitter-position-is-user-preference"
kind: "requirement"
title: "Knowledge and Context splitter positions are user preferences"
status: "confirmed"
tags: ["knowledge", "context-management", "layout", "preferences"]
created_at: "2026-08-11T18:25:12.257Z"
updated_at: "2026-08-11T18:27:26.121Z"
---

# Knowledge and Context splitter positions are user preferences

<!-- compiled_truth -->

The horizontal splitter position in Manage Knowledge and Context Management persists as an app-local user preference, so each surface restores the user's last chosen pane height.

## Timeline

- time: "2026-08-11T18:25:12.257Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["knowledge-and-context-use-whole-page-initial-loading","workspace-change-indicator-is-app-local-developer-preference"]
- time: "2026-08-11T18:25:12.257Z"
  kind: "evidence"
  summary: "Explicit user direction, 2026-08-11."
- time: "2026-08-11T18:27:26.121Z"
  kind: "evidence"
  summary: "Manage Knowledge's `projectKnowledgeSidebarWidth` is now included in the persisted `panel-state` projection, matching the already-persisted Context Management width. The panel-store migration continues to normalize restored widths."
  source: "Implementation and verification, 2026-08-11."
  affects: ["workspace-change-indicator-is-app-local-developer-preference"]
