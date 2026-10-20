---
id: "knowledge-manager-supports-permanent-record-deletion"
kind: "requirement"
title: "Knowledge manager supports permanent record deletion"
status: "confirmed"
tags: ["project-knowledge", "management", "deletion"]
created_at: "2026-08-11T22:36:38.733Z"
updated_at: "2026-08-11T22:41:08.872Z"
---

# Knowledge manager supports permanent record deletion

<!-- compiled_truth -->

Manage knowledge lets a user permanently purge a selected atomic knowledge record through a destructive confirmation. The operation removes the canonical Markdown page and its history rather than superseding or archiving the record. It also deterministically removes wiki-link references to that record from other current-truth pages and project-map roots, while leaving historical timelines immutable.

## Timeline

- time: "2026-08-11T22:36:38.733Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-11T22:36:38.733Z"
  kind: "evidence"
  summary: "User requirement, 2026-08-11: allow the knowledge manager to purge knowledge entirely rather than archive it, with a confirmed red toolbar action."
- time: "2026-08-11T22:41:08.872Z"
  kind: "decision"
  summary: "User clarified that purge must also remove deterministic references to the deleted record."
  source: "User direction, 2026-08-11"
