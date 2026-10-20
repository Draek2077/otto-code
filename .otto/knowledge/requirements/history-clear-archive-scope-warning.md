---
id: "history-clear-archive-scope-warning"
kind: "requirement"
title: "Clear archive confirmation states host scope"
status: "confirmed"
tags: ["history", "archive", "hosts", "ui", "copy"]
created_at: "2026-08-09T15:38:32.706Z"
updated_at: "2026-08-15T07:15:22.698Z"
---

# Clear archive confirmation states host scope

<!-- compiled_truth -->

The History Clear archived toolbar action is an unfilled compact action with a red label and trash icon. Its confirmation must use compact, professional dialog copy without em dashes. The first paragraph states the deletion count and scope, that active chats are unaffected, and that provider transcripts remain on the affected host or hosts. The second paragraph states that the action cannot be undone.

## Timeline

- time: "2026-08-09T15:38:32.706Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["history-archive-storage-host-picker"]
- time: "2026-08-09T15:38:32.706Z"
  kind: "evidence"
  summary: "User requirement, 2026-08-09. Implemented through the clear-archive request scope and translated dialog copy."
- time: "2026-08-09T15:45:21.544Z"
  kind: "decision"
  summary: "User clarified that the confirmation must be limited to two compact paragraphs, with the selected-host or all-hosts scope folded into the first paragraph."
  source: "User clarification, 2026-08-09"
- time: "2026-08-15T07:13:35.379Z"
  kind: "decision"
  summary: "The user explicitly required the History Clear archived toolbar action to be red, 2026-08-15."
  source: "User direction, 2026-08-15"
- time: "2026-08-15T07:15:22.698Z"
  kind: "decision"
  summary: "The user clarified that the toolbar action must use red text and icon without a red filled button, 2026-08-15."
  source: "User clarification, 2026-08-15"
