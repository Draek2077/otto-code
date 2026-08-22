---
id: "sidebar-status-dots-use-semantic-tint-tokens"
kind: "requirement"
title: "Sidebar status dots use semantic tint tokens"
status: "confirmed"
tags: ["ui","sidebar","workspace","theme","status","tints"]
created_at: "2026-08-21T23:33:21.535Z"
updated_at: "2026-08-22T00:46:46.555Z"
---
# Sidebar status dots use semantic tint tokens

<!-- compiled_truth -->

Workspace sidebar and workspace-row status indicators use the shared semantic theme tokens for their status colors: success/green uses `theme.colors.statusSuccess`, failure/red uses `theme.colors.statusDanger`, needs-input/amber uses `theme.colors.statusWarning`, and running uses `theme.colors.statusInfo`. They must not read a separate dot-only palette.

## Timeline

- time: "2026-08-21T23:33:21.535Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["interactive-state-colors-use-one-theme-accent-ladder","paseo-v040-upstream-integration"]
- time: "2026-08-21T23:33:21.535Z"
  kind: "evidence"
  summary: "User requirement and implementation verified on 2026-08-21. `getStatusDotColor` is the shared mapping used by workspace rows, project status badges, and the running status ring; focused status-dot and task-row tests passed."
- time: "2026-08-22T00:46:46.555Z"
  kind: "evidence"
  summary: "Brain's `unreachable` visual now uses the shared `statusDanger` token rather than `statusWarningMuted`, so an unreachable Brain renders red consistently with the confirmed failure/red semantic mapping. Focused brain-state tests (30), targeted lint, and app typecheck passed."
  source: "User request and implementation verification on 2026-08-21"
