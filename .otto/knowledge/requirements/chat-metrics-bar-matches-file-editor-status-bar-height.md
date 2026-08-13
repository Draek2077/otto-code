---
id: "chat-metrics-bar-matches-file-editor-status-bar-height"
kind: "requirement"
title: "Chat metrics bar matches File Editor status bar height"
status: "confirmed"
tags: ["design-system", "chat", "editor"]
created_at: "2026-08-12T23:48:24.792Z"
updated_at: "2026-08-12T23:48:24.792Z"
---

# Chat metrics bar matches File Editor status bar height

<!-- compiled_truth -->

The chat metrics bar should use the same compact vertical geometry as the File Editor status bar. Its metric text must not add extra line-height that makes the bar visibly taller than the editor status bar.

## Timeline

- time: "2026-08-12T23:48:24.792Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-12T23:48:24.792Z"
  kind: "evidence"
  summary: "User direction on 2026-08-12: make the chat metrics bar 2–3px smaller so it matches the File Editor status bar. Implemented by removing the metrics text's explicit 1.4 line-height in packages/app/src/subagents/chat-metrics-bar.tsx."
