---
id: "system-managed-subagents-remain-user-controlled"
kind: "requirement"
title: "System-managed subagents remain user-controlled"
status: "proposed"
tags: ["subagents","user-control","lifecycle"]
created_at: "2026-09-12T15:50:29.737Z"
updated_at: "2026-09-12T15:50:29.737Z"
---
# System-managed subagents remain user-controlled

<!-- compiled_truth -->

Subagents remain under user authority even when their lifecycle is managed by Otto or a provider. System ownership must not remove user-facing lifecycle controls. Users need actual control over execution and host-side archival; hiding a row only on one device is insufficient. Provider limitations and the scope of any wider stop must be explicit, and failed operations must remain visible rather than being reported as successful.

## Timeline

- time: "2026-09-12T15:50:29.737Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["observed-subagents","upstream-subagent-convergence"]
- time: "2026-09-12T15:50:29.737Z"
  kind: "evidence"
  summary: "User direction, 2026-09-12: 'there are some sub-agents we considered to be controlled by the system, but definitely we should be in control.' This corrected the preceding device-local Dismiss workaround for an unremovable Codex noop child."
