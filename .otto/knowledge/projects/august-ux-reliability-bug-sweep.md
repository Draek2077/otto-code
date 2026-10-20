---
id: "august-ux-reliability-bug-sweep"
kind: "project"
title: "August UX and reliability bug sweep"
status: "confirmed"
tags: ["app", "ui", "huggingface", "git", "updater", "chat"]
delivery_status: "partial"
progress_completed: 2
progress_total: 12
progress_unit: "workstreams"
created_at: "2026-08-11T02:19:19.744Z"
updated_at: "2026-08-11T02:25:08.001Z"
---

# August UX and reliability bug sweep

<!-- compiled_truth -->

## Objective

Resolve the reported UX and reliability regressions across the model library, pull-request views, chat playback and queueing, workspace chrome, forge switching, change tracking, themes, and Linux updates.

## Acceptance criteria

- In-progress Hugging Face downloads are separated from search results, pinned in the library, complete without a refresh, and installed models can be deleted through a destructive confirmation.
- PR and chat chrome uses correctly sized, theme-consistent icons; PR and comments default to newest-first with a user-controlled order; Bitbucket identity remains correct after forge/branch switching.
- Returning to an inactive chat restores its current transcript state without replay/grouping animation; queued text remains accessible when long and sends when an agent becomes idle.
- Compact controls maintain shared icon geometry; titlebar, right-sidebar tabs, and workspace actions expose correctly placed tooltips; workspace chrome and graphite theme have the requested separation.
- Change views do not silently auto-switch from Uncommitted after commit/push unless enabled.
- Linux updater failure is diagnosed and fixed with a verified password/elevation path.
- Active-agent rollback warning displays the actual agent and chat labels.

## Constraints

Preserve provider-neutral behavior, existing user changes, the documented UI primitives and theme tokens, backward-compatible wire contracts, and platform-specific updater boundaries. Every fixed regression gets focused coverage where practical.

## Timeline

- time: "2026-08-11T02:19:19.744Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-11T02:19:19.744Z"
  kind: "evidence"
  summary: "User bug reports and requested behavior, 2026-08-10."
- time: "2026-08-11T02:23:48.765Z"
  kind: "note"
  summary: "Implemented the model-library workstream: active Hugging Face pulls are pinned above searches, completed pulls invalidate the joined inventory cache, and installed models are visible with confirmed deletion. Focused app lint and typecheck passed."
  affects: ["august-ux-reliability-bug-sweep"]
- time: "2026-08-11T02:25:08.001Z"
  kind: "note"
  summary: "Implemented Changes-pane selection persistence: a manually selected Uncommitted or Committed mode survives commit/push dirty-state transitions. Regression coverage in review/store.test.ts passes, together with focused lint and app typecheck."
  affects: ["august-ux-reliability-bug-sweep"]
