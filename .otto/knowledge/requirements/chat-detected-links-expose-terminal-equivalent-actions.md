---
id: "chat-detected-links-expose-terminal-equivalent-actions"
kind: "requirement"
title: "Chat detected links expose terminal-equivalent actions"
status: "confirmed"
tags: ["chat", "links", "context-menu", "file-navigation"]
created_at: "2026-08-13T03:05:13.652Z"
updated_at: "2026-08-13T03:12:49.281Z"
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
