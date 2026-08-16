---
id: "orchestration-run-values-use-opt-in-scopes"
kind: "decision"
title: "Orchestration run values use opt-in scopes"
status: "proposed"
tags: ["orchestration", "run-values", "token-economy", "scope", "archdocs-retirement"]
created_at: "2026-08-16T12:15:06.677Z"
updated_at: "2026-08-16T12:15:06.677Z"
---

# Orchestration run values use opt-in scopes

<!-- compiled_truth -->

Otto's nodes are separate agent sessions, not handlers sharing a heap, so shared state is text injected into a prompt. Every scope decision is therefore a token-cost decision, which rules out global-by-default. Run values are declared on the graph like `inputs` are, with three scopes: edge (one hop, the immediate downstream node — built, stays the default), attempt (one node's retries and loop iterations — built, stays private because failed attempts must not leak into unrelated nodes' prompts), and run (the whole orchestration, visible only to nodes that opt in to reading — not built).

Two rules make run values affordable: reading is opt-in, not automatic — a node declares it reads a key, because automatic injection would grow every prompt with the run (the token-economy failure this repo refuses elsewhere); and write mode is per key, `once` or `append`. `once` makes a second write an error, which catches two nodes disagreeing about a fact; `append` serves accumulation, its order is settle order (stated, not implied), and each entry carries its source node id so a synthesis node can attribute.

Subtree scope is deliberately not a thing: an autonomous node's children already inherit its prompt context; a third lifetime needs a concrete demand first. Open question: whether an edge condition may read run values — today a condition sees only the upstream node's fields and prose, and widening that scope is a decision to take deliberately, not a default to inherit.

## Timeline

- time: "2026-08-16T12:15:06.677Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["graph-templates","orchestration-domain-model-and-engine-invariants"]
- time: "2026-08-16T12:15:06.677Z"
  kind: "evidence"
  summary: "Decided 2026-07-25 (archdocs page 12 §\"Decided, not built\", ported to Knowledge). Status proposed: the run-wide scope is designed, not built; only edge and attempt scopes exist in code. Tracked as build order in the [[graph-templates]] charter (run values are dependency 4)."
