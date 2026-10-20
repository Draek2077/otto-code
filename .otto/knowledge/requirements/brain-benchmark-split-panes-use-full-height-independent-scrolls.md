---
id: "brain-benchmark-split-panes-use-full-height-independent-scrolls"
kind: "requirement"
title: "Brain Benchmark split panes use full-height independent scrolls"
status: "confirmed"
tags: ["brain", "benchmarks", "ui", "layout", "scrolling"]
created_at: "2026-08-11T17:58:33.549Z"
updated_at: "2026-08-11T18:03:16.994Z"
---

# Brain Benchmark split panes use full-height independent scrolls

<!-- compiled_truth -->

On non-compact layouts, Brain’s Benchmark tab uses a full-height 50/50 split. The left pane owns the benchmark summary and run action bar, followed by equally sized leaderboard and run-list tables. Each table has its own fitted vertical scroll region and standard scrollbar treatment. The right results pane is independently scrollable, with its content padding inside the scroll region; the split separator spans the available tab height.

## Timeline

- time: "2026-08-11T17:58:33.549Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-model-split-panes-own-content-gutters","brain-model-bundles"]
- time: "2026-08-11T17:58:33.549Z"
  kind: "evidence"
  summary: "User direction, 2026-08-11. Implemented in packages/app/src/screens/brain/brain-screen.tsx and packages/app/src/screens/brain/benchmarks-tab.tsx."
- time: "2026-08-11T18:03:16.994Z"
  kind: "decision"
  summary: "User directed the benchmark summary and run action bar to belong solely to the left pane."
