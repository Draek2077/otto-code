---
id: "history-filter-controls-share-compact-geometry"
kind: "requirement"
title: "History filter controls share compact geometry"
status: "confirmed"
tags: ["history","filters","search","ui"]
created_at: "2026-08-15T07:08:36.213Z"
updated_at: "2026-08-22T15:21:42.166Z"
---
# History filter controls share compact geometry

<!-- compiled_truth -->

History’s host filter, project filter, and archive-status segmented control share the first navigation row and the compact 32px control geometry. Its search field is a separate row directly below, using the same shared control language and pinned clear affordance.

## Timeline

- time: "2026-08-15T07:08:36.213Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["history-host-and-archive-filters-share-one-row","history-search-uses-pinned-clear-control"]
- time: "2026-08-15T07:08:36.213Z"
  kind: "evidence"
  summary: "Explicit user direction with a rendered History screenshot, 2026-08-15. Implemented in packages/app/src/screens/sessions-screen.tsx and packages/app/src/components/hosts/host-filter.tsx."
- time: "2026-08-22T15:21:42.166Z"
  kind: "decision"
  summary: "The user separated free-form search from scope selection so navigation controls remain quick to scan."
  source: "User direction in chat, 2026-08-22; implemented and typechecked in packages/app/src/screens/sessions-screen.tsx."
