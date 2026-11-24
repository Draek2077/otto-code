---
id: "chat-detected-links-expose-terminal-equivalent-actions"
kind: "requirement"
title: "Chat detected links expose terminal-equivalent actions"
status: "confirmed"
tags: ["chat","links","context-menu","file-navigation"]
created_at: "2026-08-13T03:05:13.652Z"
updated_at: "2026-11-17T22:50:32.312Z"
---
# Chat detected links expose terminal-equivalent actions

<!-- compiled_truth -->

Detected URLs, file paths, and filenames in chat messages expose a contextual action menu. The menu always includes Copy link, and project-resolvable paths expose the same open and navigation actions available for terminal links, including Open file, Navigate to file, and Navigate to folder where applicable.

## Timeline

- time: "2026-08-13T03:05:13.652Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-13T03:05:13.652Z"
  kind: "evidence"
  summary: "User-reported bug with screenshot on 2026-08-12: chat-detected Windows executable path is visually recognized but its context menu only offers message-level Export and Expand/collapse actions. User explicitly requested Copy Link and terminal-equivalent file navigation actions."
- time: "2026-08-13T03:12:49.281Z"
  kind: "note"
  summary: "The user explicitly required chat-detected URLs and local paths to expose Copy link and project navigation actions; implementation and regression coverage now establish this as accepted product behavior. New status: confirmed."
- time: "2026-11-17T22:50:32.312Z"
  kind: "evidence"
  summary: "Philippe reports that text above multiple-choice answers cannot expose usable login links or text selection/copy, forcing cancellation before opening the site. The v0.9.35 release, pinned Paseo 0.12.0 and current Otto 0.10 worktree all render this active prompt through plain Text in components/question-form-card.tsx rather than the shared chat Markdown/link path, with no explicit selectable configuration. This remains an open presentation defect; there was no live platform reproduction or implementation today. The recovery plan calls for normal URL link actions and text selection/copy within the still-pending question, preserving selected answers and free text and never submitting/dismissing from link interaction. Existing provider/session/authentication ownership and installed 0.9.35 remain untouched. Link-opening and native selection need actual regression proof, not only source inspection."
  source: "Philippe's reported question-prompt login-link failure, verified rendering paths on 2026-11-17."
  affects: ["otto-0-10-clean-paseo-rebuild"]
