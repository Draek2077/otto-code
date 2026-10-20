---
id: "history-host-and-archive-filters-share-one-row"
kind: "requirement"
title: "History host and archive filters share one row"
status: "confirmed"
tags: ["history","hosts","filters","ui"]
created_at: "2026-08-09T15:47:15.660Z"
updated_at: "2026-08-22T15:21:37.777Z"
---
# History host and archive filters share one row

<!-- compiled_truth -->

When History shows the multi-host picker, it renders the host picker first, then the project picker and archive-status filter in one horizontal navigation row. The clear-archive action remains at the far end of that row.

## Timeline

- time: "2026-08-09T15:47:15.660Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["history-archive-storage-host-picker"]
- time: "2026-08-09T15:47:15.660Z"
  kind: "evidence"
  summary: "User requirement and implementation in packages/app/src/screens/sessions-screen.tsx, 2026-08-09."
- time: "2026-08-22T15:21:37.777Z"
  kind: "decision"
  summary: "The user expanded the History browsing row to include project scope while keeping host selection before status filtering."
  source: "User direction in chat, 2026-08-22; implemented and typechecked in packages/app/src/screens/sessions-screen.tsx."
