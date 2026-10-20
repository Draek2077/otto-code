---
id: "selected-tab-labels-use-accent-foreground"
kind: "requirement"
title: "Selected tab labels use accent foreground"
status: "confirmed"
tags: ["ui", "tabs", "theme", "design-system"]
created_at: "2026-08-14T15:49:43.645Z"
updated_at: "2026-08-14T15:57:04.307Z"
---

# Selected tab labels use accent foreground

<!-- compiled_truth -->

Selected Explorer header tabs use the active theme accent for both label and icon foreground. Selected workspace tabs use the active theme accent for their labels, while the shared workspace tab-icon component already renders their icons in accent. Explorer includes Changes, Files, Search, and pull-request tabs. A workspace tab is selected when it is active in the focused pane.

## Timeline

- time: "2026-08-14T15:49:43.645Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["active-chat-tabs-match-workspace-background","active-terminal-tabs-match-terminal-background","segmented-tabs-use-compact-horizontal-padding"]
- time: "2026-08-14T15:49:43.645Z"
  kind: "evidence"
  summary: "Explicit user direction in this chat on 2026-08-14."
- time: "2026-08-14T15:54:50.462Z"
  kind: "decision"
  summary: "The user clarified with a screenshot that the requirement targets the Explorer header strip, not all selected tab controls."
  source: "User screenshot and clarification, 2026-08-14"
  affects: ["contextual-shortcut-discovery"]
- time: "2026-08-14T15:55:55.624Z"
  kind: "decision"
  summary: "The user explicitly clarified that the workspace tab label should use the actual accent token as well."
  source: "User direction, 2026-08-14"
  affects: ["active-chat-tabs-match-workspace-background","active-terminal-tabs-match-terminal-background"]
- time: "2026-08-14T15:57:04.307Z"
  kind: "decision"
  summary: "The user identified that the selected Explorer icon must match the newly accented label."
  source: "User screenshot and direction, 2026-08-14"
  affects: ["active-chat-tabs-match-workspace-background","active-terminal-tabs-match-terminal-background"]
