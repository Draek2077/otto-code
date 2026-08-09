---
id: "history-host-and-archive-filters-share-one-row"
kind: "requirement"
title: "History host and archive filters share one row"
status: "confirmed"
tags: ["history", "hosts", "filters", "ui"]
created_at: "2026-08-09T15:47:15.660Z"
updated_at: "2026-08-09T15:47:15.660Z"
---

# History host and archive filters share one row

<!-- compiled_truth -->

When History shows the multi-host picker, it must render the host picker before the archive status filter in the same horizontal controls row so the controls remain a single row in multi-host mode.

## Timeline

- time: "2026-08-09T15:47:15.660Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["history-archive-storage-host-picker"]
- time: "2026-08-09T15:47:15.660Z"
  kind: "evidence"
  summary: "User requirement and implementation in packages/app/src/screens/sessions-screen.tsx, 2026-08-09."
