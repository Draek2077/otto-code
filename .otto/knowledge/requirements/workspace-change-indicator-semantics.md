---
id: "workspace-change-indicator-semantics"
kind: "requirement"
title: "Workspace change indicator distinguishes working tree from branch history"
status: "proposed"
tags: ["workspace", "git", "ui", "change-tracking"]
created_at: "2026-08-11T02:21:15.061Z"
updated_at: "2026-08-11T02:21:15.061Z"
---

# Workspace change indicator distinguishes working tree from branch history

<!-- compiled_truth -->

Proposed: the workspace-list `+/-` indicator should default to uncommitted working-tree changes relative to `HEAD`, so it clears after commit. Branch-versus-base history remains available as an explicitly labeled secondary signal that includes both the comparison base and commit count; the UI must never silently switch an indicator's meaning after a commit. A user preference may choose the displayed indicator.

## Timeline

- time: "2026-08-11T02:21:15.061Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["august-ux-reliability-bug-sweep"]
- time: "2026-08-11T02:21:15.061Z"
  kind: "evidence"
  summary: "User request, 2026-08-10: `+/-` should reflect uncommitted work like terminal git-status prompts, not branch changes already committed; branch/base information should be distinguishable at commit level."
