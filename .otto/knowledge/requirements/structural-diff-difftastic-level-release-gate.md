---
id: "structural-diff-difftastic-level-release-gate"
kind: "requirement"
title: "Difftastic-level structural diff requires proof"
status: "confirmed"
tags: ["diff", "structural-diff", "quality-gate", "performance", "testing"]
created_at: "2026-08-13T08:20:59.536Z"
updated_at: "2026-08-13T08:20:59.536Z"
---

# Difftastic-level structural diff requires proof

<!-- compiled_truth -->

Structural diff must not be described as Difftastic-level until all of the following are demonstrated:

1. Line pairing is replaced or augmented by a real simplified-AST comparison with explicit, language-specific parser capability tiers.
2. Each file snapshot is parsed once and its structural index reused; enforced tests measure and bound time and memory complexity.
3. Split selection, scroll ownership, visible structural fallback reasons, syntax-palette ownership, and agent-fragment eligibility are correct on every review surface.
4. Every structural fixture expectation is executable, with rendered and end-to-end regression coverage for Changes, File History, Refine, and tool/edit-card review surfaces.

Until then, Structural is an incomplete prototype and Line remains the authoritative review path.

## Timeline

- time: "2026-08-13T08:20:59.536Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["structural-diff-review-experience","diff-review-experience","language-support-grows-with-structural-diff","diff-visual-language-is-syntax-palette-owned","new-diff-selection-is-capability-gated"]
- time: "2026-08-13T08:20:59.536Z"
  kind: "evidence"
  summary: "Explicit user acceptance gate on 2026-08-13, following the proposed finding [[structural-diff-audit-correctness-and-performance-gaps]]."
