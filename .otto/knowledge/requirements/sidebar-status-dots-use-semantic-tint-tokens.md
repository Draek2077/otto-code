---
id: "sidebar-status-dots-use-semantic-tint-tokens"
kind: "requirement"
title: "Sidebar status dots use semantic tint tokens"
status: "proposed"
tags: ["ui","sidebar","workspace","theme","status","tints"]
created_at: "2026-08-21T23:33:21.535Z"
updated_at: "2026-11-17T23:42:28.416Z"
---
# Sidebar status dots use semantic tint tokens

<!-- compiled_truth -->

Workspace sidebar and workspace-row status indicators use the shared semantic theme family: success/green uses `theme.colors.statusSuccess`, failure/red uses `theme.colors.statusDanger`, and needs-input/amber uses `theme.colors.statusWarning`. Running activity is blue. Otto 0.9 uses `theme.colors.statusInfo`; the clean Paseo 0.12 base has no such token, so Otto 0.10 projects the released light/dark blue in its owned chat-identity palette without changing the base theme. Do not introduce separate warning, failure or success dot palettes.

Workspace status is dual-state. The centered dot represents the workspace’s highest-priority status, while a spinner independently represents whether any root chat in that workspace is active. A needs-input or failed dot therefore remains visible inside the spinner when another chat is running; activity must not replace or downgrade the status signal.

A green completed-result dot is unread attention, not workspace navigation state. Opening or returning to its workspace, including restoring app visibility, must never clear it. It remains until the user deliberately activates the agent tab that produced it, or otherwise explicitly engages that chat.

Workspace activity rings stay blue and have a visible center dot. Chat-tab and in-chat working spinners instead use the explicitly assigned Agent Profile/Personality's saved two glow colors; unassigned chats use Otto's default theme pair. A shared provider or model never implies an assigned Profile. Status glyph colors retain their semantic meaning independently of the working spinner pair. Loading, indexing or stale aggregate running status alone must never animate workspace chat activity.

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
- time: "2026-08-22T04:15:08.141Z"
  kind: "decision"
  summary: "User established that workspace status is dual-state: active-chat motion must remain visible while an amber, red, or green status remains the primary signal."
  source: "User request and verified implementation on 2026-08-21"
- time: "2026-08-22T04:19:33.811Z"
  kind: "evidence"
  summary: "Implementation now derives `hasActiveChat` independently from the aggregate workspace status: only a running root chat animates the spinner, while loading, indexing, creation, and archive state cannot. The centered amber needs-input dot is shifted one pixel right in both workspace-row variants. Focused activity, status-badge, and workspace-view-model tests passed (34 tests), with targeted lint and full repository typecheck green."
  source: "Focused local verification on 2026-08-21"
- time: "2026-08-22T04:25:35.064Z"
  kind: "evidence"
  summary: "Removed the fallback that inferred `hasActiveChat` from aggregate workspace `running` status. Only an explicit running root-chat record may now animate the spinner; terminal, indexing, and stale aggregate activity remain status-dot-only. Added a regression test for an aggregate running workspace with no root chat."
  source: "Focused local verification on 2026-08-21"
- time: "2026-08-22T04:28:48.141Z"
  kind: "evidence"
  summary: "A root agent’s raw lifecycle can remain `running` while it has a pending permission/question. `hasActiveChat` now uses the normalized status bucket instead, so needs-input, failed, and attention states do not animate the spinner. A regression test also proves a genuinely running older chat still keeps the spinner when a newer question owns the amber dot."
  source: "Focused local verification on 2026-08-21"
- time: "2026-08-25T16:31:10.882Z"
  kind: "decision"
  summary: "User clarified that a workspace result must remain visible until its producing chat tab is deliberately activated; verified implementation now distinguishes workspace-route focus from an actual agent-tab activation."
  source: "User direction and focused app verification, 2026-08-25"
- time: "2026-11-17T23:42:28.416Z"
  kind: "decision"
  summary: "Philippe explicitly clarified the workspace spinner's visible center and blue ring, versus assigned Profile colors in chat tabs/chat. Reconcile the selected clean-base theme projection while preserving dual-state and unread ownership rules. Status returned to proposed for review."
  source: "Philippe's current instructions and verified Otto 0.10 source/typecheck/focused unit tests; native/browser visual acceptance remains pending."
