---
id: "knowledge-review-signals-separate-complete-and-partial-tag-overlap"
kind: "requirement"
title: "Knowledge review signals distinguish complete and partial tag overlap"
status: "confirmed"
tags: ["project-knowledge", "review-signals", "knowledge-health"]
created_at: "2026-08-11T22:32:35.693Z"
updated_at: "2026-08-11T22:47:29.328Z"
---

# Knowledge review signals distinguish complete and partial tag overlap

<!-- compiled_truth -->

Documents retain their existing **Review signals** section. The section groups each document's current signals into counted bullet points: identical complete tag sets, partial tag overlap, overlapping current truth, and stale review. It does not list related articles, rename the section, add a separate Health view, or change navigation. Review-only diagnostics remain separate from persisted knowledge records.

## Timeline

- time: "2026-08-11T22:32:35.693Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-11T22:32:35.693Z"
  kind: "evidence"
  summary: "User direction, 2026-08-11: separate records that overlap in all tags from those that share one or more but not all tags, and implement the grouped report."
- time: "2026-08-11T22:36:43.547Z"
  kind: "decision"
  summary: "User direction, 2026-08-11: rename the review-only ProjectKnowledgeFinding diagnostic to ProjectKnowledgeHealth so it is unambiguous beside first-class finding records."
- time: "2026-08-11T22:42:03.974Z"
  kind: "decision"
  summary: "User direction, 2026-08-11: report aggregate Knowledge health metrics instead of attaching detailed overlap lists to every record."
  source: "User direction, 2026-08-11"
  affects: ["knowledge-review-signals-separate-complete-and-partial-tag-overlap"]
- time: "2026-08-11T22:42:38.283Z"
  kind: "decision"
  summary: "User direction, 2026-08-11: add dedicated tools to inspect Knowledge health in detail and guide manual resolution."
  source: "User direction, 2026-08-11"
  affects: ["knowledge-review-signals-separate-complete-and-partial-tag-overlap"]
- time: "2026-08-11T22:42:48.552Z"
  kind: "decision"
  summary: "User correction, 2026-08-11: Finding is a normal ProjectKnowledgeKind alongside decision, constraint, requirement, and architecture. ProjectKnowledgeHealth remains the name for review-only diagnostics; Finding does not gain a separate metadata model or lifecycle."
- time: "2026-08-11T22:47:29.328Z"
  kind: "decision"
  summary: "User correction, 2026-08-11: preserve the Documents Review signals heading and group its existing per-document signals into counted bullet points only."
  source: "User correction, 2026-08-11"
  affects: ["knowledge-review-signals-separate-complete-and-partial-tag-overlap"]
