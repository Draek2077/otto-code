---
id: "orchestration-per-node-accounting-is-a-precondition"
kind: "decision"
title: "Orchestration per-node accounting is a precondition"
status: "proposed"
tags: ["orchestration", "accounting", "observability", "precondition", "archdocs-retirement"]
created_at: "2026-08-16T12:15:29.483Z"
updated_at: "2026-08-16T12:15:29.483Z"
---

# Orchestration per-node accounting is a precondition

<!-- compiled_truth -->

Per-node accounting is a precondition for comparing templates, not an observability nicety. Two graph templates cannot be compared without cost, latency and token counts per node, so this blocks any answer to "does orchestrating actually work". `RunPhaseCandidate` gains `startedAt`/`completedAt`, `tokens`/`cost` rolled up from the child agent's own accounting, and a tool-call record (`name`, `latency`, and enough to count actions). Shape informed by AgentX-Python's trace unit.

This is the measurement layer the [[graph-templates]] charter is built on — per-node accounting is its build-order item 1, and nothing else in that charter measures anything without it.

## Timeline

- time: "2026-08-16T12:15:29.483Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["graph-templates","orchestration-domain-model-and-engine-invariants"]
- time: "2026-08-16T12:15:29.483Z"
  kind: "evidence"
  summary: "Decided 2026-07-25 (archdocs page 12 §\"Decided, not built\", ported to Knowledge). Status proposed: `RunPhaseCandidate` does not carry the timing/token/cost/tool-call fields in code yet. Tracked as build order in the [[graph-templates]] charter."
