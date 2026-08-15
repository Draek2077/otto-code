---
id: "history-filter-controls-share-compact-geometry"
kind: "requirement"
title: "History filter controls share compact geometry"
status: "confirmed"
tags: ["history", "filters", "search", "ui"]
created_at: "2026-08-15T07:08:36.213Z"
updated_at: "2026-08-15T07:08:36.213Z"
---

# History filter controls share compact geometry

<!-- compiled_truth -->

History’s host filter, archive-status segmented control, and search field share one centered controls row and the compact 32px control geometry, so their boxes and labels align visibly.

## Timeline

- time: "2026-08-15T07:08:36.213Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["history-host-and-archive-filters-share-one-row","history-search-uses-pinned-clear-control"]
- time: "2026-08-15T07:08:36.213Z"
  kind: "evidence"
  summary: "Explicit user direction with a rendered History screenshot, 2026-08-15. Implemented in packages/app/src/screens/sessions-screen.tsx and packages/app/src/components/hosts/host-filter.tsx."
