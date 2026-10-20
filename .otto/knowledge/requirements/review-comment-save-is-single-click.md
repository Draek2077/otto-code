---
id: "review-comment-save-is-single-click"
kind: "requirement"
title: "Review comment Save works on the first click"
status: "confirmed"
tags: ["diffs", "code-review", "interaction", "developer-experience"]
created_at: "2026-08-14T18:04:18.544Z"
updated_at: "2026-08-14T18:04:18.544Z"
---

# Review comment Save works on the first click

<!-- compiled_truth -->

A focused inline review comment editor must save when the user clicks Save once. Losing editor focus to the Save control must not require a second click or otherwise discard the intended submit action.

## Timeline

- time: "2026-08-14T18:04:18.544Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["diff-review-experience","diff-review-comment-threads-are-viewport-bound"]
- time: "2026-08-14T18:04:18.544Z"
  kind: "evidence"
  summary: "User explicitly reported that typing a sidebar review comment and then clicking Save required first leaving the textbox and clicking Save again, and requested that this be fixed on 2026-08-14."
