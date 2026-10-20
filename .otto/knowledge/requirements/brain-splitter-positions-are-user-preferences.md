---
id: "brain-splitter-positions-are-user-preferences"
kind: "requirement"
title: "Brain splitter positions are user preferences"
status: "confirmed"
tags: ["brain", "models", "benchmarks", "layout", "preferences"]
created_at: "2026-08-11T21:23:31.663Z"
updated_at: "2026-08-11T21:34:28.277Z"
---

# Brain splitter positions are user preferences

<!-- compiled_truth -->

On non-compact layouts, Brain’s Models and Benchmark vertical splitters persist independently as app-local user preferences. Benchmark’s horizontal splitter between leaderboard and runs also persists. Every saved share is normalized to the 25–75% range, preserving a substantial responsive pane on either side; each pane gives up secondary detail before primary model, score, run, and task information.

## Timeline

- time: "2026-08-11T21:23:31.663Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-benchmark-split-panes-use-full-height-independent-scrolls","brain-model-split-panes-own-content-gutters"]
- time: "2026-08-11T21:23:31.663Z"
  kind: "evidence"
  summary: "Explicit user direction, 2026-08-11."
- time: "2026-08-11T21:28:33.108Z"
  kind: "evidence"
  summary: "Implemented app-local persisted `modelsSplitRatio`, `benchmarksSplitRatio`, and `benchmarkTablesSplitRatio` in `packages/app/src/screens/brain/brain-layout-store.ts`. `BrainSplitter` applies each saved share with a 25–75% clamp on native and web; the Models and Benchmark tables now give up fixed name/config floors so primary identifiers and scores remain visible as panes narrow. Targeted lint and the persistence-normalization test pass."
  source: "Implementation and verification, 2026-08-11."
- time: "2026-08-11T21:32:12.197Z"
  kind: "evidence"
  summary: "Corrected BrainSplitter affordance to match existing workspace splitters: an 8px draggable grab band with a centered hairline, web col-resize/row-resize cursor, and semantic separator attributes. Split-ratio calculations account for the full grab band."
  source: "User feedback and implementation, 2026-08-11."
- time: "2026-08-11T21:33:23.043Z"
  kind: "evidence"
  summary: "Corrected the prior splitter-affordance implementation: BrainSplitter now renders exactly one 1px divider, matching existing split surfaces. Its larger interaction target remains invisible through the gesture handler's hit slop; the web resize cursor remains on the one-pixel separator."
  source: "User correction and implementation, 2026-08-11."
- time: "2026-08-11T21:34:28.277Z"
  kind: "evidence"
  summary: "A 2px Brain seam was traced to the shared 1px splitter rendered adjacent to a legacy 1px detail-pane border. Removed the redundant detail-pane border from Benchmark and Models so the shared splitter is the sole visible seam."
  source: "Visual inspection of user screenshot and implementation, 2026-08-11."
