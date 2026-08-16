---
id: "ports-and-conditions-are-not-competitors"
kind: "decision"
title: "Ports and conditions are not competitors"
status: "proposed"
tags: ["orchestration", "graphs", "ports", "conditions", "control-flow", "archdocs-retirement"]
created_at: "2026-08-16T12:14:53.575Z"
updated_at: "2026-08-16T12:14:53.575Z"
---

# Ports and conditions are not competitors

<!-- compiled_truth -->

In the graph engine, named ports and edge conditions both exist and answer different questions; the failure mode is using one for the other's job. A port asks "which outcome did this node produce?" — declared by the node kind at design time, mutually exclusive (the node fires exactly one), and checkable by the validator (it can require every outcome be wired). A condition asks "should this edge carry data, given the values?" — declared by the graph author per edge, independent (several may fire, or none), and opaque (an expression cannot be statically checked).

Rule: if the node kind knows its outcomes at design time, that is a port (gate approved/rejected, check pass/fail, router one per branch, map each/done); if the author is filtering on values the node produced, that is a condition. Ports serve control nodes; conditions stay for data-driven edges between agent nodes; they compose (an edge off the `pass` port may also carry a condition).

The failure to avoid: expressing a gate's approve/reject as two conditions over a faked `{approved:true}` field. Nothing then enforces that exactly one branch runs, nothing can answer "what happens on reject?", and the canvas shows two identical wires instead of two labelled sockets. `GraphEdge.fromPort`/`toPort` are reserved in the schema and unused by the engine; ports land with the gate node, or the gate is built wrong.

## Timeline

- time: "2026-08-16T12:14:53.575Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["graph-templates","orchestration-domain-model-and-engine-invariants","orchestration-node-capabilities"]
- time: "2026-08-16T12:14:53.575Z"
  kind: "evidence"
  summary: "Decided 2026-07-25 (archdocs page 12 §\"Decided, not built\", ported to Knowledge). Status proposed: the gate node and named ports are designed, not built — `fromPort`/`toPort` are reserved in the schema and unused by the engine until the gate lands."
