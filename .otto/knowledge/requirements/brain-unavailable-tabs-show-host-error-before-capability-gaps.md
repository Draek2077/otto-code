---
id: "brain-unavailable-tabs-show-host-error-before-capability-gaps"
kind: "requirement"
title: "Brain unavailable tabs show host errors before capability gaps"
status: "proposed"
tags: ["brain","overview","models","logs","error-state","ui"]
created_at: "2026-08-22T01:18:37.287Z"
updated_at: "2026-08-22T01:22:57.385Z"
---
# Brain unavailable tabs show host errors before capability gaps

<!-- compiled_truth -->

Brain tabs that require a live brain host must show a clear stopped or unreachable error before capability-gap messaging. In full-height tabs, only the error banner receives inset spacing; the replacement content remains unpadded so split and table surfaces can own their layout.

## Timeline

- time: "2026-08-22T01:18:37.287Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-22T01:18:37.287Z"
  kind: "evidence"
  summary: "Implemented and verified on 2026-08-21 in packages/app/src/screens/brain/brain-screen.tsx, brain-availability.ts, and models-tab.tsx. The focused brain-availability regression suite passes 4/4; app typecheck and targeted lint pass."
- time: "2026-08-22T01:22:57.385Z"
  kind: "evidence"
  summary: "Follow-up verified on 2026-08-21: Brain Overview now treats a dropped host connection or failed status request as a degraded state, retains only the Server and Runtime tiles, and hides resource, traffic, host-detail, and live-activity sections. Focused regression suite passes 6/6; app typecheck and targeted lint pass."
  source: "packages/app/src/screens/brain/overview-tab.tsx and brain-availability.test.ts"
  affects: ["brain-overview-top-tiles-share-height"]
