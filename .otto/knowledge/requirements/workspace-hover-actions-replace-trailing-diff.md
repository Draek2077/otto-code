---
id: "workspace-hover-actions-replace-trailing-diff"
kind: "requirement"
title: "Workspace hover actions replace trailing diff metadata"
status: "proposed"
tags: ["sidebar","hover","workspace","desktop","ui"]
created_at: "2026-08-21T22:02:35.256Z"
updated_at: "2026-08-21T22:04:42.189Z"
---
# Workspace hover actions replace trailing diff metadata

<!-- compiled_truth -->

When a desktop workspace row reveals its hover actions, the trailing diff or timestamp is hidden and the action control owns the slot above the row content without overlap.

## Timeline

- time: "2026-08-21T22:02:35.256Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["primary-sidebars-use-a-deeper-surface-than-tab-rails","borderless-page-headers-and-dev-branch-badges"]
- time: "2026-08-21T22:02:35.256Z"
  kind: "evidence"
  summary: "User-provided Windows desktop screenshot showed the green/red diff counts colliding with the hover action button. Implemented the shared trailing-slot visibility rule for project and status workspace rows so the diff/timestamp is hidden while the kebab action is visible, with an explicit overlay z-index."
- time: "2026-08-21T22:04:42.189Z"
  kind: "evidence"
  summary: "The hover action treatment must be flat: no gradient, scrim, or fade should be painted behind the kebab. The selected workspace row should remain a uniform highlight while the action control is shown."
  source: "User-provided Windows desktop screenshot"
  affects: ["primary-sidebars-use-a-deeper-surface-than-tab-rails"]
