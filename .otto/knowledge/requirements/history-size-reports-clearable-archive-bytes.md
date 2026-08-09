---
id: "history-size-reports-clearable-archive-bytes"
kind: "requirement"
title: "History size reports clearable archive bytes"
status: "confirmed"
tags: ["history", "archive", "storage", "ui", "deletion"]
created_at: "2026-08-09T15:56:43.314Z"
updated_at: "2026-08-09T15:56:43.314Z"
---

# History size reports clearable archive bytes

<!-- compiled_truth -->

Any per-chat size shown in History must represent only the Otto archive record bytes that Clear archived will delete. Provider transcripts and other files that remain after clearing must be excluded, so the displayed size matches the user's deletion expectation.

## Timeline

- time: "2026-08-09T15:56:43.314Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["history-archive-storage-host-picker","history-host-and-archive-filters-share-one-row"]
- time: "2026-08-09T15:56:43.314Z"
  kind: "evidence"
  summary: "User clarification, 2026-08-09. The clear path deletes Otto agent records and intentionally leaves provider transcripts."
