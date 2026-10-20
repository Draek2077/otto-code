---
id: "chat-metrics-bar-matches-file-editor-status-bar-height"
kind: "requirement"
title: "Chat metrics bar matches File Editor status bar height"
status: "confirmed"
tags: ["design-system","chat","editor"]
created_at: "2026-08-12T23:48:24.792Z"
updated_at: "2026-08-21T02:15:00.650Z"
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
- time: "2026-08-21T00:59:44.666Z"
  kind: "evidence"
  summary: "User identified that the chat metrics bar's top separator area had the wrong fill compared with the File Editor status bar. Verified that ChatMetricsBar added surfaceChrome while EditorStatusBar uses only the border hairline; removed the metrics bar background fill so both surfaces use the same separator treatment."
  source: "User direction and implementation on 2026-08-20"
  affects: ["packages-app-src-subagents-chat-metrics-bar-tsx","packages-app-src-editor-editor-status-bar-tsx"]
- time: "2026-08-21T02:15:00.650Z"
  kind: "evidence"
  summary: "User requested increasing the chat metrics bar height by 0.5px. Implemented by changing its vertical padding from 4px to 4.25px on each edge in packages/app/src/subagents/chat-metrics-bar.tsx, preserving the existing border and horizontal geometry."
  source: "User direction and implementation on 2026-08-20"
  affects: ["packages-app-src-subagents-chat-metrics-bar-tsx"]
