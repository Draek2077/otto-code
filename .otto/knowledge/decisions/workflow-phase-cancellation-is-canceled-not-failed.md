---
id: "workflow-phase-cancellation-is-canceled-not-failed"
kind: "decision"
title: "Workflow phases stopped by the user are canceled, never failed"
status: "confirmed"
tags: ["workflows","orchestration","cancellation","protocol"]
created_at: "2026-08-30T00:46:10.916Z"
updated_at: "2026-08-30T00:46:10.916Z"
---
# Workflow phases stopped by the user are canceled, never failed

<!-- compiled_truth -->

A Workflow phase has a distinct terminal status `canceled` (protocol `RUN_PHASE_STATUSES`, open string on the wire). It is used when the user stops the work: a worker interrupted by a run cancel, and a rejected attended gate on either engine. `failed` is reserved for real errors. A gate rejection also sets `run.error` to the gate name plus the reviewer's note, so the Workflows library never shows a bare canceled run. In the graph engine only the terminal branch of `executeGraphRun` sets `run.status`; a gate never flips the run to canceled while sibling branches are still settling. The app renders `canceled` with the warning tint (user decision), not the error tint, and shows its notes.

## Timeline

- time: "2026-08-30T00:46:10.916Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["workflows","orchestration-graph-engine-execution-model","orchestration-domain-model-and-engine-invariants"]
- time: "2026-08-30T00:46:10.916Z"
  kind: "evidence"
  summary: "Decided 2026-08-29 while closing the 0.9 Workflows work, resolving finding-2026-08-29-canceled-graph-worker-phase-status. Code: packages/protocol/src/orchestration.ts, packages/server/src/server/orchestration/graph-engine.ts (executeGraphGate, markCanceled), run-engine.ts (runGatePhase), packages/app/src/screens/runs-screen.tsx. Docs: docs/orchestration-node-capabilities.md \"Human approval gates\". Proven by graph-engine.test.ts, run-engine.test.ts and run-orchestration.integration.test.ts."
