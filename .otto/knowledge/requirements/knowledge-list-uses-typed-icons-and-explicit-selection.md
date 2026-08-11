---
id: "knowledge-list-uses-typed-icons-and-explicit-selection"
kind: "requirement"
title: "Knowledge list uses typed icons and explicit selection"
status: "confirmed"
tags: ["project-knowledge", "ui", "navigation", "iconography"]
created_at: "2026-08-11T07:05:52.004Z"
updated_at: "2026-08-11T07:32:19.399Z"
---

# Knowledge list uses typed icons and explicit selection

<!-- compiled_truth -->

The Manage Knowledge record list is compact navigation, not a content preview. Every item shows only its title in the `xs` compact type scale and carries an icon that represents its knowledge type. Rows use 8px internal horizontal and vertical padding, with no resting chrome; their rounded hover uses the standard translucent surface and their selected state uses the theme's moderate selected-surface token. The selection state is visible without an accent rail or an overly elevated card.

## Timeline

- time: "2026-08-11T07:05:52.004Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-11T07:05:52.004Z"
  kind: "evidence"
  summary: "User direction with Manage Knowledge screenshot, 2026-08-11. Implemented in packages/app/src/project-knowledge/panel.tsx."
- time: "2026-08-11T07:08:51.755Z"
  kind: "decision"
  summary: "User rejected the accent selection bar on 2026-08-11 and directed the list to follow the workspace list's quiet rounded hover/selected interaction pattern."
  source: "User direction, 2026-08-11"
- time: "2026-08-11T07:10:29.664Z"
  kind: "decision"
  summary: "User reviewed the stronger contrast treatment on 2026-08-11 and directed that it be made more restrained."
  source: "User direction, 2026-08-11"
- time: "2026-08-11T07:24:46.506Z"
  kind: "decision"
  summary: "User direction, 2026-08-11: remove metadata from the left Knowledge record list."
  source: "User direction, 2026-08-11"
- time: "2026-08-11T07:30:20.896Z"
  kind: "decision"
  summary: "User direction, 2026-08-11: use compact workspace-title-sized type for Knowledge list rows."
  source: "User direction, 2026-08-11"
- time: "2026-08-11T07:32:19.399Z"
  kind: "decision"
  summary: "User direction, 2026-08-11: reduce Knowledge list title text to xs and its row padding to 8px."
  source: "User direction, 2026-08-11"
