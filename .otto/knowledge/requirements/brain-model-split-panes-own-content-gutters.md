---
id: "brain-model-split-panes-own-content-gutters"
kind: "requirement"
title: "Brain model split panes own content gutters"
status: "confirmed"
tags: ["brain", "models", "ui", "layout"]
created_at: "2026-08-11T17:50:41.018Z"
updated_at: "2026-08-11T17:54:32.946Z"
---

# Brain model split panes own content gutters

<!-- compiled_truth -->

In Brain’s Models tab, the split container itself has no outer padding, so its separator spans the tab content area. The list pane owns its inner content gutter. The detail pane’s scroll region reaches the pane edge, while its scroll content owns the horizontal and top gutter, so the right-side scrollbar is not inset outside the scrollable area.

## Timeline

- time: "2026-08-11T17:50:41.018Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-model-bundles"]
- time: "2026-08-11T17:50:41.018Z"
  kind: "evidence"
  summary: "User direction with Brain Models screenshot, 2026-08-11. Implemented in packages/app/src/screens/brain/brain-screen.tsx and packages/app/src/screens/brain/models-tab.tsx."
- time: "2026-08-11T17:54:32.946Z"
  kind: "decision"
  summary: "User clarified that the right pane's gutter belongs inside the scroll content, not outside the scroll region."
