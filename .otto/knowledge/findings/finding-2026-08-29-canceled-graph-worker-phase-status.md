---
id: "finding-2026-08-29-canceled-graph-worker-phase-status"
kind: "finding"
title: "Canceled Graph active workers currently project as failed phases"
status: "superseded"
tags: ["workflows","graph-execution","cancellation","finding"]
created_at: "2026-08-29T12:31:15.306Z"
updated_at: "2026-08-30T00:46:03.745Z"
---
# Canceled Graph active workers currently project as failed phases

<!-- compiled_truth -->

A source-backed in-process daemon Graph run shows that cancelling a run with an active worker correctly interrupts the child session and ends the durable run as `canceled`. The active worker phase is currently projected as `failed`, while the downstream unstarted phase is projected as `skipped` with skip reason `canceled`. This is a verified observation, not a decision: the product must decide whether the active node should visibly remain failed, gain an explicit canceled state, or use another truthful presentation before the Graph visualizer contract is called complete.

## Timeline

- time: "2026-08-29T12:31:15.306Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["workflows","graph-templates","e2e-qa-coverage"]
- time: "2026-08-29T12:31:15.306Z"
  kind: "evidence"
  summary: "Method: run the Brief → Decision Graph against the existing FakeAgentClient with its research worker held until interrupt, wait for the real in-process daemon agent lifecycle to become running, call RunService.cancelRun, then assert the terminal persisted Run and child lifecycle. Result: run status canceled; active brief phase failed; decision skipped/canceled; child session idle; no decision child spawned. Focused integration command passed on 2026-08-29 along with targeted lint and server typecheck."
- time: "2026-08-30T00:46:02.305Z"
  kind: "evidence"
  summary: "Resolved 2026-08-29: `canceled` added to RUN_PHASE_STATUSES (packages/protocol/src/orchestration.ts) and isTerminalPhaseStatus. graph-engine.ts marks an abort-interrupted worker and a rejected gate as `canceled`; run-engine.ts marks a rejected gate `canceled`; both set run.error to the gate name and reviewer note. The same Brief → Decision integration case now asserts brief=canceled, decision=skipped/canceled, run=canceled. Unit (114), integration (21) and CLI e2e (1) tests green; protocol, server and app typecheck clean."
  affects: ["workflows","orchestration-graph-engine-execution-model"]
- time: "2026-08-30T00:46:03.745Z"
  kind: "reversal"
  summary: "The observation was decided and fixed: phases stopped by the user now carry an explicit `canceled` status. Superseded by the decision page workflow-phase-cancellation-is-canceled-not-failed. New status: superseded."
