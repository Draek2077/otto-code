---
id: "brain-header-controls-wrap-responsively"
kind: "requirement"
title: "Brain host and tab controls share a responsive toolbar"
status: "proposed"
tags: ["brain", "responsive-layout", "multi-host", "ui"]
created_at: "2026-08-09T03:15:42.239Z"
updated_at: "2026-08-09T03:16:52.987Z"
---

# Brain host and tab controls share a responsive toolbar

<!-- compiled_truth -->

In multi-host Brain mode, the host selector and Brain tab selector share one centered responsive toolbar. They remain side by side while their intrinsic widths fit the available space, then wrap into two rows when the available width is insufficient.

## Timeline

- time: "2026-08-09T03:15:42.239Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-09T03:15:42.239Z"
  kind: "evidence"
  summary: "User requirement from 2026-08-08; implemented in packages/app/src/screens/brain/brain-screen.tsx with a flex-wrapping toolbar."
- time: "2026-08-09T03:16:52.987Z"
  kind: "evidence"
  summary: "When switching hosts, the selected Brain content tab must remain active instead of resetting to Overview. The BrainHostPanel must stay mounted across active host changes; unsupported tabs may still be redirected by the existing capability guard."
  source: "User follow-up requirement and implementation in packages/app/src/screens/brain/brain-screen.tsx"
