---
id: "knowledge-sidebar-summary-is-compact-and-centered"
kind: "requirement"
title: "Knowledge sidebar summary is compact and centered"
status: "confirmed"
tags: ["project-knowledge", "ui", "sidebar"]
created_at: "2026-08-11T07:07:04.626Z"
updated_at: "2026-08-11T07:39:51.907Z"
---

# Knowledge sidebar summary is compact and centered

<!-- compiled_truth -->

The Manage Knowledge sidebar opens with category controls, a centered category summary, and the create action. It does not repeat the Knowledge title or explanatory subtitle. The summary has 4px of vertical breathing room. When project progress is measured, the summary presents it compactly as a percentage followed by “progress”.

## Timeline

- time: "2026-08-11T07:07:04.626Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-11T07:07:04.626Z"
  kind: "evidence"
  summary: "User direction with Manage Knowledge screenshot, 2026-08-11. Implemented in packages/app/src/project-knowledge/panel.tsx."
- time: "2026-08-11T07:39:14.840Z"
  kind: "decision"
  summary: "User direction, 2026-08-11: shorten the Projects summary label from “measured progress” to “progress”."
  source: "User direction, 2026-08-11"
- time: "2026-08-11T07:39:51.907Z"
  kind: "decision"
  summary: "User direction, 2026-08-11: add another 2px above and below the summary stats."
  source: "User direction, 2026-08-11"
