---
id: "diff-renderer-structural-parity"
kind: "requirement"
title: "New diff renderer preserves legacy structural presentation"
status: "confirmed"
tags: ["diff", "review", "gutter", "visual-parity"]
created_at: "2026-08-13T04:45:08.938Z"
updated_at: "2026-08-13T04:46:19.979Z"
---

# New diff renderer preserves legacy structural presentation

<!-- compiled_truth -->

For the same review surface, legacy and new diff renderers must share the same configured monospace typography, line-height rhythm, and enclosing top/bottom separators. Structural behavior may add richer semantics, but switching renderer must not visibly change the host's baseline diff presentation. The new gutter also exposes the established hover comment affordance in its reserved seam before comment actions are wired.

## Timeline

- time: "2026-08-13T04:45:08.938Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["structural-diff-review-experience","diff-review-experience"]
- time: "2026-08-13T04:45:08.938Z"
  kind: "evidence"
  summary: "Explicit user review of Appearance diff preview required border parity, identical structural line-height styling, and the hover '+' affordance on new-renderer gutters."
- time: "2026-08-13T04:46:19.979Z"
  kind: "evidence"
  summary: "Removed DiffViewer's renderer-internal code insets and trailing scroll reserve. New Line had been using these while Structural bypassed them, producing mode-dependent framed widths. Both new modes now render edge-to-edge inside the same host-owned diff frame."
  source: "Appearance preview visual audit"
  affects: ["structural-diff-review-experience"]
