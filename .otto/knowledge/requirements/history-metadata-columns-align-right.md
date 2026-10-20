---
id: "history-metadata-columns-align-right"
kind: "requirement"
title: "History metadata columns align right"
status: "confirmed"
tags: ["history", "ui", "layout", "table"]
created_at: "2026-08-09T16:34:38.213Z"
updated_at: "2026-08-09T16:43:28.109Z"
---

# History metadata columns align right

<!-- compiled_truth -->

On desktop History, the metadata headings and row values must share one compact column grid, right-align within each column, use 10px gaps, and leave remaining width to the conversation description. The Host column appears only in the all-hosts view; it is omitted when a specific host filter is active.

## Timeline

- time: "2026-08-09T16:34:38.213Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["history-host-and-archive-filters-share-one-row"]
- time: "2026-08-09T16:34:38.213Z"
  kind: "evidence"
  summary: "User requirement, 2026-08-09. Implemented in packages/app/src/components/agent-list.tsx."
- time: "2026-08-09T16:43:28.109Z"
  kind: "decision"
  summary: "User clarified that the selected host makes the Host column redundant, 2026-08-09."
  source: "User requirement and implementation in packages/app/src/screens/sessions-screen.tsx."
  affects: ["history-host-and-archive-filters-share-one-row"]
