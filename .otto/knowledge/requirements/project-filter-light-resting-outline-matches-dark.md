---
id: "project-filter-light-resting-outline-matches-dark"
kind: "requirement"
title: "Project filter light resting outline matches dark"
status: "confirmed"
tags: ["artifacts", "filters", "themes", "ui"]
created_at: "2026-08-09T17:03:27.611Z"
updated_at: "2026-08-09T17:04:27.212Z"
---

# Project filter light resting outline matches dark

<!-- compiled_truth -->

Light theme border swatches match their `surface2` fill, so bordered controls including the Artifacts project filter keep the same visually flat resting outline as dark themes.

## Timeline

- time: "2026-08-09T17:03:27.611Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-09T17:03:27.611Z"
  kind: "evidence"
  summary: "User requirement and implementation in packages/app/src/components/project-filter.tsx, 2026-08-09."
- time: "2026-08-09T17:04:27.212Z"
  kind: "decision"
  summary: "User clarified that the correction belongs in the shared light-theme swatches, not in a project-filter-specific style override."
  source: "User clarification and implementation in packages/app/src/styles/theme.ts, 2026-08-09."
