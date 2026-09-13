---
id: "search-fields-provide-pinned-clear-control"
kind: "requirement"
title: "Search fields provide a pinned clear control"
status: "confirmed"
tags: ["ui","search","accessibility"]
created_at: "2026-08-11T21:52:29.529Z"
updated_at: "2026-09-13T05:12:39.101Z"
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
- time: "2026-09-13T05:12:39.101Z"
  kind: "evidence"
  summary: "User requested a search field pinned at the top of the Project Knowledge Tags popup. The implementation uses shared SearchField in the menu sticky header, with case-insensitive filtering, an accessible clear control, preserved tag selections, an empty-results row, and query reset on close. Menu measurement updates retain focus inside the surface and editable fields retain their text-navigation keys. App typecheck and targeted lint passed. Live verification of this search addition remains incomplete: Metro exited with ENOENT while watching a temporary Vite test-cache directory; the earlier animation fix was browser-verified before that exit."
  source: "packages/app/src/project-knowledge/panel.tsx; packages/app/src/components/ui/menu/menu-overlay.tsx; docs/project-knowledge.md"
