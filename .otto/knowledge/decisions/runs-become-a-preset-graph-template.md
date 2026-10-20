---
id: "runs-become-a-preset-graph-template"
kind: "decision"
title: "Runs become a preset graph template"
status: "proposed"
tags: ["orchestration", "runs", "graphs", "convergence", "archdocs-retirement"]
created_at: "2026-08-16T12:14:41.216Z"
updated_at: "2026-08-16T12:14:41.216Z"
---

# Runs become a preset graph template

<!-- compiled_truth -->

Phase runs collapse into the graph engine, not the other way around. The graph engine out-capabilities the phase engine on every axis except two: human gates, and per-phase candidate fan-out with keep-best (a phase can spawn N candidates from one task and top up until enough pass; a graph node runs one worker per attempt). Once the graph engine has both — a gate node and candidate fan-out — the phase vocabulary (research → plan → … → deliver) survives as a starter graph template, not a second execution model: one scheduler, one capability set. Two prerequisites, not one; until both land, both engines run and both are documented.

The convergence has a second half: the conductor eventually emits graphs rather than phase plans. MCP graph-authoring tools (author a graph, save it as a template, start it) let an agent generate its own orchestration shapes, and this is safe by construction because an AI-authored graph passes the same shared hard gate (validateOrchestrationGraph + validateEdgeConditions) as a human-drawn one. The tool boundary validates the declaration; nothing executes un-checked.

## Timeline

- time: "2026-08-16T12:14:41.216Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["graph-templates","orchestration-domain-model-and-engine-invariants"]
- time: "2026-08-16T12:14:41.216Z"
  kind: "evidence"
  summary: "Decided 2026-07-25 (archdocs page 12 §\"Decided, not built\", since ported to Knowledge). Status proposed because it is a settled decision awaiting implementation: the gate node and candidate fan-out do not exist in the graph engine yet. Tracked as build order in the [[graph-templates]] charter."
