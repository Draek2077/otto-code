---
id: "hide-hey-otto-outside-dictation-tabs"
kind: "requirement"
title: "Hide Hey Otto outside dictation tabs"
status: "proposed"
tags: ["app", "voice", "dictation", "wake-word"]
created_at: "2026-08-09T02:12:13.282Z"
updated_at: "2026-08-09T02:12:13.282Z"
---

# Hide Hey Otto outside dictation tabs

<!-- compiled_truth -->

The workspace title bar should hide the Hey Otto control when the focused tab is not a draft or agent tab with dictation UI, rather than rendering a disabled control. Existing feature-enabled and native wake-word capability gates remain in force.

## Timeline

- time: "2026-08-09T02:12:13.282Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-09T02:12:13.282Z"
  kind: "evidence"
  summary: "User requirement in this task; implemented in packages/app/src/screens/workspace/workspace-screen.tsx and covered by packages/app/src/voice/wake-word-control-state.test.ts."
