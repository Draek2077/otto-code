---
id: "visualizer-demo-available-with-no-active-chats"
kind: "requirement"
title: "Visualizer demo is available when no chats are active"
status: "confirmed"
tags: ["visualizer", "demo", "ui"]
created_at: "2026-08-11T23:45:50.912Z"
updated_at: "2026-08-11T23:45:50.912Z"
---

# Visualizer demo is available when no chats are active

<!-- compiled_truth -->

The Visualizer exposes its built-in demo scenario through a toolbar control only when the workspace has no open chat tabs and the page reports no sessions; the control remains available while the demo is running so users can stop it.

## Timeline

- time: "2026-08-11T23:45:50.912Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-11T23:45:50.912Z"
  kind: "evidence"
  summary: "User request on 2026-08-11; implemented in visualizer-surface.tsx and visualizer-toolbar.tsx with the host/page cold-restart transition."
