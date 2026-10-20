---
id: "new-workspace-start-empty-action"
kind: "requirement"
title: "New workspace offers a start empty workspace action"
status: "confirmed"
tags: ["new-workspace","workspace","chat","ui"]
created_at: "2026-08-21T18:51:48.354Z"
updated_at: "2026-08-21T18:51:48.354Z"
---
# New workspace offers a start empty workspace action

<!-- compiled_truth -->

The New workspace page offers a “Start empty workspace” action alongside its documentation actions. It creates the selected workspace without an initial agent or prompt, then navigates to that workspace with a focused new draft chat opened.

## Timeline

- time: "2026-08-21T18:51:48.354Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T18:51:48.354Z"
  kind: "evidence"
  summary: "User request, 2026-08-21. Implemented in packages/app/src/screens/new-workspace-screen.tsx and packages/app/src/screens/new-workspace-empty.ts, with coverage in packages/app/src/screens/new-workspace-empty.test.ts."
