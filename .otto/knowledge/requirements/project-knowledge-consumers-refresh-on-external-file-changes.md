---
id: "project-knowledge-consumers-refresh-on-external-file-changes"
kind: "requirement"
title: "Project knowledge consumers refresh on external file changes"
status: "confirmed"
tags: ["project-knowledge", "context-management", "filesystem-watching", "ui-consistency"]
created_at: "2026-08-11T13:17:05.492Z"
updated_at: "2026-08-11T13:17:05.492Z"
---

# Project knowledge consumers refresh on external file changes

<!-- compiled_truth -->

Every open Otto surface that renders project knowledge, including Manage Knowledge and Context Management, refreshes when the canonical `.otto/knowledge` documents change outside that surface. Otto-originated writes notify consumers after the atomic write; Git pulls, checkouts, editor saves, and other external changes are observed from the canonical project-root directory with a debounced daemon-owned watcher. Consumers update lightweight catalog and token summaries, refresh the selected document when it still exists, and clearly clear a deleted selection rather than rendering stale content.

## Timeline

- time: "2026-08-11T13:17:05.492Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-11T13:17:05.492Z"
  kind: "evidence"
  summary: "User direction, 2026-08-11: Manage Knowledge and Context Management must update on screen when knowledge documents change outside their respective managers."
