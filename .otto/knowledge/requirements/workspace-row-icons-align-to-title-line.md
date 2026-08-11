---
id: "workspace-row-icons-align-to-title-line"
kind: "requirement"
title: "Workspace row icons align to the title line"
status: "confirmed"
tags: ["ui", "responsive-layout", "sidebar", "workspaces"]
created_at: "2026-08-11T04:09:13.750Z"
updated_at: "2026-08-11T04:39:41.317Z"
---

# Workspace row icons align to the title line

<!-- compiled_truth -->

In compact workspace rows, leading status/loading indicators and trailing controls must share the project row's responsive geometry and center against the workspace card's complete content stack. Their placement must remain visually balanced as subtitles, PR badges, host labels, and other metadata appear or disappear; they must not be attached to a particular text line.

## Timeline

- time: "2026-08-11T04:09:13.750Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-11T04:09:13.750Z"
  kind: "evidence"
  summary: "User request with mobile workspace sidebar screenshot on 2026-08-10; shared row layout places leading and trailing affordances inside the title-line container."
- time: "2026-08-11T04:39:41.317Z"
  kind: "decision"
  summary: "The user clarified on 2026-08-10 that workspace affordances must adapt to the full variable-height row rather than align to the title line."
  source: "User clarification"
