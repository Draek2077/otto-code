---
id: "brain-benchmark-compared-run-cards-align-task-rows"
kind: "requirement"
title: "Brain Benchmark compared run cards align task rows"
status: "confirmed"
tags: []
created_at: "2026-08-11T18:26:15.380Z"
updated_at: "2026-08-11T18:26:15.380Z"
---

# Brain Benchmark compared run cards align task rows

<!-- compiled_truth -->

When comparing two Brain benchmark runs in a non-compact layout, the run cards share a stretched height and reserve a two-line task-detail area for every task row so corresponding task scores remain horizontally aligned despite summary wrapping.

## Timeline

- time: "2026-08-11T18:26:15.380Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-benchmark-split-panes-use-full-height-independent-scrolls"]
- time: "2026-08-11T18:26:15.380Z"
  kind: "evidence"
  summary: "User direction, 2026-08-11. Implemented in packages/app/src/screens/brain/benchmarks-tab.tsx."
