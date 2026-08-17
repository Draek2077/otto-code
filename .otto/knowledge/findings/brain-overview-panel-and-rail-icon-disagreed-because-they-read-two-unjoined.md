---
id: "brain-overview-panel-and-rail-icon-disagreed-because-they-read-two-unjoined"
kind: "finding"
title: "Brain overview panel and rail icon disagreed because they read two unjoined trackers"
status: "proposed"
tags: ["brain", "overview", "rail-icon", "status-consistency", "slots"]
created_at: "2026-08-17T03:37:28.543Z"
updated_at: "2026-08-17T03:37:28.543Z"
---

# Brain overview panel and rail icon disagreed because they read two unjoined trackers

<!-- compiled_truth -->

The Brain Overview "Live model activity" panel and the rail icon rendered two independent measurements as one picture: the summary line from the proxy's `inference` tracker (ReasoningTracker, request-level, per-chunk SSE) and the slot rows from `slots.threads` (llama-server `/slots`, sampled 4 Hz, engine phase only). `modelActivityPhase` passed the GLOBAL inference thinking/generating counts into every row, so one thinking request relabelled every decode slot "Thinking" while the summary said "1 thinking"; the rail icon preferred the request-level `inference` counts over slot phases, so it could contradict the panel's own rows. Stopgap landed in overview-tab.tsx and brain-state.ts: rows label only their own engine phase (prefill → "Processing prompt", else "Decoding"), the panel captions the two readouts, and `deriveInferenceState` reads `reasoning` + slot phases + queued, never the `inference` counts. Note `reasoning` on the wire is `inference.thinking > 0` (router sets it from ReasoningTracker.active), so the thinking branch is unchanged. Durable fix is the queued task adding a slot id to per-request inference stages so request stage joins to slot exactly; until then the sub-second tracker divergence is acknowledged in UI copy, not hidden.

## Timeline

- time: "2026-08-17T03:37:28.543Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-managed-process-pool","brain-overview-traffic-host-divider-removed"]
- time: "2026-08-17T03:37:28.543Z"
  kind: "evidence"
  summary: "User screenshots: summary \"1 processing prompt · 1 thinking\" with one prefill slot row; and two rows both \"Thinking\" under \"1 thinking\". Root cause confirmed in packages/app/src/screens/brain/overview-tab.tsx modelActivityPhase and packages/app/src/components/brain/brain-state.ts deriveInferenceState. Tests updated in brain-state.test.ts; 59 brain-related unit tests + app typecheck pass."
