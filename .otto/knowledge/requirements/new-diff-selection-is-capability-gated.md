---
id: "new-diff-selection-is-capability-gated"
kind: "requirement"
title: "New diff selection is capability-gated"
status: "confirmed"
tags: ["diff", "review", "structural-diff", "capabilities"]
created_at: "2026-08-13T04:37:59.092Z"
updated_at: "2026-08-13T04:37:59.092Z"
---

# New diff selection is capability-gated

<!-- compiled_truth -->

Every diff surface selects the new renderer only when the user or surface enables it and the specific file is eligible for new-diff capabilities. All other combinations show the actual legacy renderer. The Appearance diff viewer exposes both conditions and renders the same source fragment through the resulting real path.

## Timeline

- time: "2026-08-13T04:37:59.092Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["structural-diff-review-experience","diff-review-experience"]
- time: "2026-08-13T04:37:59.092Z"
  kind: "evidence"
  summary: "Explicit user requirement: demo driven by whether old/new diff is enabled and whether the file is part of new-diff capabilities; unsupported files must show old diff."
