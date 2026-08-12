---
id: "brain-benchmark-empty-state"
kind: "requirement"
title: "Brain benchmark empty-state UX"
status: "proposed"
tags: ["otto-brain", "benchmarks", "ui", "empty-state"]
created_at: "2026-08-12T02:19:51.778Z"
updated_at: "2026-08-12T02:24:24.814Z"
---

# Brain benchmark empty-state UX

<!-- compiled_truth -->

The Brain Benchmarks tab always renders its normal leaderboard and Runs surfaces, even before any completed results exist. A running benchmark appears as the first Runs row with a spinner, its live status message, and a compact red X cancellation action. There is no separate page-level job card or centered empty state.

## Timeline

- time: "2026-08-12T02:19:51.778Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-12T02:19:51.778Z"
  kind: "evidence"
  summary: "User feedback with screenshot, 2026-08-11: the no-data benchmark UI was not good; implementation adjusted the duplicate empty/status presentation."
- time: "2026-08-12T02:24:24.814Z"
  kind: "decision"
  summary: "User direction, 2026-08-11: a live benchmark should immediately occupy the Runs table and use the same compact row treatment as model operations."
  source: "User feedback, 2026-08-11"
