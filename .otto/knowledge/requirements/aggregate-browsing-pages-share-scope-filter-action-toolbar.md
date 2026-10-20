---
id: "aggregate-browsing-pages-share-scope-filter-action-toolbar"
kind: "requirement"
title: "Aggregate browsing pages share a scope, filter, and action toolbar"
status: "confirmed"
tags: ["ui","navigation","filters","history","artifacts","schedules","orchestrations"]
created_at: "2026-08-22T15:28:09.847Z"
updated_at: "2026-08-22T15:52:35.301Z"
---
# Aggregate browsing pages share a scope, filter, and action toolbar

<!-- compiled_truth -->

Aggregate browsing pages place the host picker (when multiple hosts exist), project picker, and page-status filter together in that order on the leading toolbar row. The page action is held at the far end of the same row. On constrained layouts, the controls wrap without changing that order. History keeps its free-form search in a dedicated row immediately beneath this shared toolbar.

Kanban's host, project, and board picker toolbar uses the same leading inset and top spacing as the aggregate-page toolbars, with no separator beneath it.

On entry, History, Artifacts, Schedules, and Orchestrations resolve their initial host and project filters from the active workspace or last workspace the reader viewed. An explicit host or project picker choice, including All hosts or All projects, remains authoritative; unavailable context follows the normal all-scope fallback.

## Timeline

- time: "2026-08-22T15:28:09.847Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-22T15:28:09.847Z"
  kind: "evidence"
  summary: "User direction in chat, 2026-08-22: the filters must be on the same row as the project picker for consistent presentation. Implemented and typechecked in History, Artifacts, Schedules, and Orchestrations."
- time: "2026-08-22T15:47:27.857Z"
  kind: "decision"
  summary: "User established that aggregate pages should inherit the last project context by default, with All remaining an explicit broadening choice."
  source: "User direction in chat, 2026-08-22; implemented with focused unit coverage and app validation."
- time: "2026-08-22T15:52:35.301Z"
  kind: "decision"
  summary: "User established that Kanban’s toolbar must align with the other pages and must not draw a one-off separator beneath it."
  source: "User direction in chat, 2026-08-22; implemented and app-validated."
