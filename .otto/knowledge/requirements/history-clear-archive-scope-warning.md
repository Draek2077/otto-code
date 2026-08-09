---
id: "history-clear-archive-scope-warning"
kind: "requirement"
title: "Clear archive confirmation states host scope"
status: "confirmed"
tags: ["history", "archive", "hosts", "ui", "copy"]
created_at: "2026-08-09T15:38:32.706Z"
updated_at: "2026-08-09T15:45:21.544Z"
---

# Clear archive confirmation states host scope

<!-- compiled_truth -->

The History clear-archive confirmation must use compact, professional dialog copy without em dashes. Its first paragraph states the deletion count and scope, that active chats are unaffected, and that provider transcripts remain on the affected host or hosts. Its second paragraph states that the action cannot be undone.

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
