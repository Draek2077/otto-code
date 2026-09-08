---
id: "visualizer-pip-window-overlay-and-edge-anchoring"
kind: "requirement"
title: "Visualizer PIP is window-wide and edge-anchored"
status: "confirmed"
tags: ["visualizer","pip","desktop","layout","browser"]
created_at: "2026-09-06T01:45:11.708Z"
updated_at: "2026-09-08T04:07:46.033Z"
---
# Visualizer PIP is window-wide and edge-anchored

<!-- compiled_truth -->

On web and Electron, the Visualizer PIP renders in Otto's window overlay plane, above resident browser webviews and free to cross the workspace and left sidebar. It measures the full app viewport rather than any Explorer or workspace pane. Resizing preserves its inset from the nearer horizontal and vertical edge, clamping only when the viewport is too small for the PIP, so Explorer visibility cannot hide or strand it off-screen.

## Timeline

- time: "2026-09-06T01:45:11.708Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["visualizer-pip"]
- time: "2026-09-06T01:45:11.708Z"
  kind: "evidence"
  summary: "User explicitly approved the window-wide PIP placement on 2026-09-05. Implemented in `packages/app/src/visualizer/visualizer-pip.tsx` and `use-visualizer-pip-drag.ts`; focused edge-anchoring tests, targeted lint, app typecheck, and `git diff --check` passed."
- time: "2026-09-08T04:07:46.033Z"
  kind: "evidence"
  summary: "Fixed Electron PIP drag ghosting in `packages/app/src/visualizer/visualizer-pip.tsx`: the drag-positioned frame is now an ordinary host `View`, while a child `Animated.View` owns only the presence fade. This prevents the Electron guest webview from remaining at its former compositor position while the frame moves. `use-visualizer-pip-drag.test.ts`, targeted lint, app typecheck, and `git diff --check` passed."
  source: "2026-09-07 implementation and targeted verification"
