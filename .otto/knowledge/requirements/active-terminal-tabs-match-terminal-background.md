---
id: "active-terminal-tabs-match-terminal-background"
kind: "requirement"
title: "Active terminal tabs match terminal background"
status: "confirmed"
tags: ["ui", "workspace-tabs", "terminal", "theme"]
created_at: "2026-08-09T18:38:59.270Z"
updated_at: "2026-08-09T18:38:59.270Z"
---

# Active terminal tabs match terminal background

<!-- compiled_truth -->

The active terminal tab uses the terminal emulator background color as an exception to the workspace-surface rule, while retaining the shared active-tab accent outline.

## Timeline

- time: "2026-08-09T18:38:59.270Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["active-chat-tabs-match-workspace-background"]
- time: "2026-08-09T18:38:59.270Z"
  kind: "evidence"
  summary: "User requirement stated on 2026-08-09 with a screenshot; implemented in packages/app/src/screens/workspace/workspace-desktop-tabs-row.tsx using the terminal's surfaceCode token."
