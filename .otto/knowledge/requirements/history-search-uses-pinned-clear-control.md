---
id: "history-search-uses-pinned-clear-control"
kind: "requirement"
title: "History search uses a pinned clear control"
status: "confirmed"
tags: ["history","search","ui","accessibility"]
created_at: "2026-08-15T05:52:31.360Z"
updated_at: "2026-08-22T15:21:33.183Z"
---
# History search uses a pinned clear control

<!-- compiled_truth -->

History provides a free-form search field in a dedicated row below the host, project, and archive controls. It filters loaded conversations by visible conversation, project, workspace, branch, and host metadata, and uses the shared accessible pinned clear control to restore the unfiltered list.

## Timeline

- time: "2026-08-15T05:52:31.360Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["search-fields-provide-pinned-clear-control","history-host-and-archive-filters-share-one-row"]
- time: "2026-08-15T05:52:31.360Z"
  kind: "evidence"
  summary: "Explicit user direction, 2026-08-14. Implemented in packages/app/src/screens/sessions-screen.tsx with filter coverage in packages/app/src/history/filter-history-agents.test.ts."
- time: "2026-08-22T15:21:33.183Z"
  kind: "decision"
  summary: "The user revised History navigation to put scope and archive filters in the first row and free-form search in a dedicated row beneath it."
  source: "User direction in chat, 2026-08-22; implemented and typechecked in packages/app/src/screens/sessions-screen.tsx."
