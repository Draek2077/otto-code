---
id: "diff-review-comment-threads-are-viewport-bound"
kind: "requirement"
title: "Diff review comment threads are viewport-bound"
status: "confirmed"
tags: ["diffs", "code-review", "layout", "developer-experience"]
created_at: "2026-08-13T07:55:41.325Z"
updated_at: "2026-08-13T07:55:41.325Z"
---

# Diff review comment threads are viewport-bound

<!-- compiled_truth -->

Inline comment cards in every diff presentation must size and pin to the visible diff viewport independently of code-line wrapping or the intrinsic width of unwrapped code. Horizontal scrolling remains available for code, but must never carry the review comment UI off screen.

## Timeline

- time: "2026-08-13T07:55:41.325Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["diff-review-experience","diff-renderer-structural-parity"]
- time: "2026-08-13T07:55:41.325Z"
  kind: "evidence"
  summary: "User-reported diff viewer bug with unwrapped lines on 2026-08-13: the comment card goes off screen; user explicitly requires that wrapping code must not determine comment UI visibility."
