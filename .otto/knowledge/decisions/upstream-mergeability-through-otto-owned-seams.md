---
id: "upstream-mergeability-through-otto-owned-seams"
kind: "decision"
title: "Preserve Paseo mergeability through Otto-owned seams"
status: "confirmed"
tags: ["upstream","paseo","architecture","maintainability","fork-policy"]
created_at: "2026-09-04T16:59:26.216Z"
updated_at: "2026-09-04T16:59:26.216Z"
---
# Preserve Paseo mergeability through Otto-owned seams

<!-- compiled_truth -->

All future Otto work must preserve a readily mergeable Paseo base. Treat upstream code as the default owner of its behavior and keep it as close to verbatim as practical. New functionality belongs in Otto-owned modules, adapters, projection layers, composition roots, and additive protocol capabilities. A change to a high-churn upstream file requires a demonstrated necessity, the smallest possible localized patch, a comment or durable record explaining the seam, and verification against the relevant upstream baseline.

For the Android relay performance work specifically, the design must prefer a relay-aware Otto delivery layer and Otto-owned request/payload instrumentation over rewrites of Paseo's shared checkout, session, or renderer paths. Protocol additions remain backward-compatible and feature-gated; no legacy fallback implementation is added.

## Timeline

- time: "2026-09-04T16:59:26.216Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["upstream-subagent-convergence","paseo-v040-upstream-integration","diff-review-experience","project-knowledge-context-management"]
- time: "2026-09-04T16:59:26.216Z"
  kind: "evidence"
  summary: "Explicit user direction, 2026-09-04. Generalizes the split-by-layer seam established in [[upstream-subagent-convergence]] and the repository's fork mission in AGENTS.md."
