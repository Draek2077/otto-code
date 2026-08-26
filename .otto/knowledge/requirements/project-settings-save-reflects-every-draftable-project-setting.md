---
id: "project-settings-save-reflects-every-draftable-project-setting"
kind: "requirement"
title: "Project Settings Save reflects every draftable project setting"
status: "superseded"
tags: ["project-settings","save-state","project-links","kanban"]
created_at: "2026-08-20T05:48:26.004Z"
updated_at: "2026-08-26T13:19:33.475Z"
---
# Project Settings Save reflects every draftable project setting

<!-- compiled_truth -->

The Project Settings header Save control must reflect unsaved changes from every draftable project-scoped setting, including project configuration, cross-project links, and the Kanban board target. These settings remain staged until the user explicitly saves, and the existing unsaved-changes navigation guard must cover them.

## Timeline

- time: "2026-08-20T05:48:26.004Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["kanban-is-reached-via-host-project-pickers-the-board-target-is-configured-per"]
- time: "2026-08-26T13:19:33.475Z"
  kind: "reversal"
  summary: "The user removed the project-links system on 2026-08-26, so the proposed requirement's cross-project-link setting no longer exists. Remaining Project Settings save behavior is implemented by the configuration and Kanban sections without this overlapping proposal. New status: superseded."
