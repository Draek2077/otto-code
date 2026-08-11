---
id: "search-fields-provide-pinned-clear-control"
kind: "requirement"
title: "Search fields provide a pinned clear control"
status: "confirmed"
tags: ["ui", "search", "accessibility"]
created_at: "2026-08-11T21:52:29.529Z"
updated_at: "2026-08-11T21:52:29.529Z"
---

# Search fields provide a pinned clear control

<!-- compiled_truth -->

Whenever a user has entered a search term, Otto search fields provide an accessible X control pinned at the field's right edge. Activating it clears the term and restores the unfiltered results. This applies to Settings, Manage Knowledge, shared comboboxes, and modal-sheet header searches.

## Timeline

- time: "2026-08-11T21:52:29.529Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["knowledge-lists-support-title-search"]
- time: "2026-08-11T21:52:29.529Z"
  kind: "evidence"
  summary: "Explicit user direction, 2026-08-11. Implemented with the shared `SearchClearButton` component and adopted by Settings, Manage Knowledge, combobox, and adaptive modal-sheet search controls."
