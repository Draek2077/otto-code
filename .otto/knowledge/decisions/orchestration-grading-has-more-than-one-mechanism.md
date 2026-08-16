---
id: "orchestration-grading-has-more-than-one-mechanism"
kind: "decision"
title: "Orchestration grading has more than one mechanism"
status: "proposed"
tags: ["orchestration", "grading", "check-node", "verdicts", "archdocs-retirement"]
created_at: "2026-08-16T12:15:39.935Z"
updated_at: "2026-08-16T12:15:39.935Z"
---

# Orchestration grading has more than one mechanism

<!-- compiled_truth -->

Today Otto grades with exactly one mechanism: an agent judger returning a prose verdict — the most expensive, slowest and driftiest option available. The decision is that a node's acceptance test may be deterministic where the answer is checkable, and a model judge only where it is not. The `check` node (command + expectation, no model — ground truth rather than opinion) is the first mechanism to add.

This is the same decision the [[graph-templates]] charter's measurement workstream records (workstream 1.3): deterministic checks where the answer is checkable, similarity scoring where a reference answer exists, an LLM judge only where neither applies.

## Timeline

- time: "2026-08-16T12:15:39.935Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["graph-templates","orchestration-domain-model-and-engine-invariants"]
- time: "2026-08-16T12:15:39.935Z"
  kind: "evidence"
  summary: "Decided 2026-07-25 (archdocs page 12 §\"Decided, not built\", ported to Knowledge). Status proposed: only the LLM-judge mechanism exists in code; the `check` node and deterministic grading are not built. Cross-references the [[graph-templates]] charter."
