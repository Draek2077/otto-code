---
id: "structural-diff-comments-follow-paired-code-rows"
kind: "requirement"
title: "Structural diff comments follow paired code rows"
status: "proposed"
tags: ["diffs","code-review","layout","developer-experience"]
created_at: "2026-08-21T00:34:56.041Z"
updated_at: "2026-08-21T00:34:56.041Z"
---
# Structural diff comments follow paired code rows

<!-- compiled_truth -->

In the Changes sidebar Structural diff viewer, an inline review thread for a paired before/after row must render as a full-width row immediately below that pair. It must never be nested in either code column. If either side has a thread, its card remains between surrounding diff rows and is sized against the visible diff viewport.

## Timeline

- time: "2026-08-21T00:34:56.041Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["diff-review-experience","diff-review-comment-threads-are-viewport-bound"]
- time: "2026-08-21T00:34:56.041Z"
  kind: "evidence"
  summary: "User-reported bug and required behavior, 2026-08-20. Implementation updates `packages/app/src/components/diff-viewer/diff-viewer-content.tsx` so paired Structural cells suppress nested threads and the pair renders its side-specific threads directly after the paired row."
