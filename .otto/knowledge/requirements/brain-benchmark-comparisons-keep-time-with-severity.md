---
id: "brain-benchmark-comparisons-keep-time-with-severity"
kind: "requirement"
title: "Brain Benchmark comparisons retain time with outlier severity"
status: "confirmed"
tags: []
created_at: "2026-08-11T21:21:48.670Z"
updated_at: "2026-08-11T21:42:09.545Z"
---

# Brain Benchmark comparisons retain time with outlier severity

<!-- compiled_truth -->

Brain Benchmark comparison cards keep the Time column visible. A task time that is at least 5% faster than its matched task time in the other compared run is green. A task time that is substantially slower is amber, and an extreme slowdown is red; normal values remain neutral.

## Timeline

- time: "2026-08-11T21:21:48.670Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-benchmark-compared-run-cards-align-task-rows","brain-benchmark-task-score-severity-scale"]
- time: "2026-08-11T21:21:48.670Z"
  kind: "evidence"
  summary: "Explicit user direction, 2026-08-11."
- time: "2026-08-11T21:24:05.127Z"
  kind: "evidence"
  summary: "Implemented in packages/app/src/screens/brain/benchmarks-tab.tsx. Compared task rows retain Time while dropping only Weight; matched task durations with a 1.5x difference are amber and 2x difference red, symmetrically for either edge, with no green time tone. Focused Vitest coverage passes."
  source: "Implementation and focused verification, 2026-08-11."
- time: "2026-08-11T21:37:57.036Z"
  kind: "decision"
  summary: "User clarified that timing severity must be directional: only higher elapsed time is a performance concern."
  source: "Explicit user direction, 2026-08-11."
- time: "2026-08-11T21:42:09.545Z"
  kind: "decision"
  summary: "User added a success state for the fastest comparison-relative task times."
  source: "Explicit user direction, 2026-08-11."
