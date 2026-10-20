---
id: "manage-knowledge-status-filters-use-icon-only-segments"
kind: "requirement"
title: "Manage Knowledge status filters use icon-only segments"
status: "proposed"
tags: ["project-knowledge","ui","filters","iconography"]
created_at: "2026-09-06T14:37:00.862Z"
updated_at: "2026-09-06T14:37:00.862Z"
---
# Manage Knowledge status filters use icon-only segments

<!-- compiled_truth -->

The Manage Knowledge status filters are icon-only segmented controls: `all_inclusive` for All, `handshake` for Proposed, `verified` for Confirmed, and `history` for History. Each icon has the original label as its accessible name and reveals that label in a desktop hover tooltip.

## Timeline

- time: "2026-09-06T14:37:00.862Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-09-06T14:37:00.862Z"
  kind: "evidence"
  summary: "User direction, 2026-09-06. Implemented in packages/app/src/project-knowledge/panel.tsx and verified with workspace typecheck, targeted lint, and packages/app/src/components/icons/material-icons.test.ts."
