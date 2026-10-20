---
id: "architectural-view-authoring-splitter-is-user-preference"
kind: "requirement"
title: "Architectural View authoring splitter is a user preference"
status: "confirmed"
tags: ["architectural-views","layout","preferences"]
created_at: "2026-09-06T14:46:14.626Z"
updated_at: "2026-09-06T14:46:14.626Z"
---
# Architectural View authoring splitter is a user preference

<!-- compiled_truth -->

The horizontal chat-to-preview splitter in Architectural View authoring persists as one app-local percentage preference. The remembered `[chat, preview]` shares restore across every authoring session, including the staged-draft-to-normal-chat promotion, and are normalized so neither pane can reopen collapsed.

## Timeline

- time: "2026-09-06T14:46:14.626Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["architecture-visual-documents"]
- time: "2026-09-06T14:46:14.626Z"
  kind: "evidence"
  summary: "Explicit user direction, 2026-09-06. Implemented and verified in `packages/app/src/stores/architectural-view-authoring-layout-store.ts` with focused normalization tests; both authoring surfaces consume the shared store."
