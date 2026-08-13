---
id: "diff-review-experience"
kind: "requirement"
title: "Unified structural diff review experience"
status: "confirmed"
tags: ["developer-experience", "diffs", "refactor", "code-review"]
created_at: "2026-08-13T00:05:58.344Z"
updated_at: "2026-08-13T08:33:49.079Z"
---

# Unified structural diff review experience

<!-- compiled_truth -->

Otto will provide a consistent, review-grade, Difftastic-inspired diff experience across Changes, file history, Refactor/Refine, tool/edit cards, and other user-visible diff surfaces. One persisted Settings choice controls every code-review surface: Compact Line or Structural. There are no per-surface or per-diff presentation overrides. Both align corresponding code and suppress duplicate near-identical lines. Compact Line renders a rename or tiny replacement as only the new changed token in a third foreground color, not as a pair of near-duplicate lines. Structural is a composed, per-block view rather than a globally side-by-side layout: it uses paired columns where direct before/after comparison helps, and a single shared column for context, pure additions or removals, formatting-only changes, and tightly aligned structural edits. Matched code that changed only location or order is rendered in a neutral third foreground color, such as purple, in both presentations. Formatting-only changes use a distinct neutral background, never added or removed red/green tints, and users can turn those formatting indicators off entirely. The foreground and formatting colors are first-class syntax-theme diff tokens, deliberately defined by every syntax highlighting theme rather than borrowed from the app's status palette. Reordering never inserts explanatory prose into the diff. The mixed visual demo must exercise the per-block layout planner rather than imposing a single layout on all of its examples. Structural matching must advance through a version-pinned, provenance-preserving Difftastic fixture corpus using fast, deterministic pure unit tests: no app boot, daemon, browser, or Difftastic executable is allowed on the inner development loop. Structural support is a product-wide commitment for every language Otto currently supports for syntax highlighting and language parsing, not a selected subset. A language remains on the complete Line fallback only until it meets the same fixture, confidence, safety, and performance bar. Before either presentation ships beyond the visual spike, Otto must audit and consolidate fragmented diff surfaces, beginning with Refactor/Refine parity. The existing exact patch review remains the authoritative fallback for unsupported syntax, unavailable complete source, parser failure, binary or oversized content.

## Timeline

- time: "2026-08-13T00:05:58.344Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-13T00:05:58.344Z"
  kind: "evidence"
  summary: "User decision on 2026-08-12 to make Difftastic-style structural review a separate project and provide a persisted default-view preference."
- time: "2026-08-13T01:49:16.988Z"
  kind: "decision"
  summary: "The user clarified that both supported Difftastic-inspired presentations must avoid duplicating near-identical lines; the previous wording incorrectly treated only Structural as Difftastic-style."
  source: "User clarification, 2026-08-13"
  affects: ["structural-diff-review-experience"]
- time: "2026-08-13T02:04:20.683Z"
  kind: "decision"
  summary: "The user clarified the semantic color and visibility rules after inspecting the in-app visual spike."
  source: "User visual-design decision, 2026-08-13"
  affects: ["structural-diff-review-experience"]
- time: "2026-08-13T02:15:29.580Z"
  kind: "decision"
  summary: "The user explicitly required every syntax-highlighting theme to provide the third diff foreground color."
  source: "User visual-design decision, 2026-08-13"
  affects: ["structural-diff-review-experience"]
- time: "2026-08-13T02:19:10.217Z"
  kind: "decision"
  summary: "The user specified that formatting-only changes need a neutral theme background and an option to hide them entirely."
  source: "User visual-design decision, 2026-08-13"
  affects: ["structural-diff-review-experience"]
- time: "2026-08-13T02:20:26.689Z"
  kind: "decision"
  summary: "The user clarified that Structural must compose line and paired layouts per diff block, as Difftastic’s presentation rules do, rather than force one layout across a mixed review."
  source: "User visual-design decision informed by Difftastic documentation, 2026-08-13"
  affects: ["structural-diff-review-experience"]
- time: "2026-08-13T02:28:49.944Z"
  kind: "decision"
  summary: "The user required a fast deterministic fixture-driven unit-test loop so structural diff quality can iterate without full app or orchestration runs."
  source: "User quality-process decision, 2026-08-13"
  affects: ["structural-diff-review-experience"]
- time: "2026-08-13T02:47:18.777Z"
  kind: "decision"
  summary: "The user requires Structural support to extend to every language already supported by Otto syntax highlighting and language parsing, rather than a small initial subset."
  source: "User product-scope decision, 2026-08-13"
  affects: ["structural-diff-review-experience"]
- time: "2026-08-13T07:58:33.101Z"
  kind: "decision"
  summary: "User clarified on 2026-08-13 that presentation must be all-or-nothing from one Settings choice; local review toggles are not part of the product contract."
  source: "User product decision, 2026-08-13"
  affects: ["structural-diff-review-experience"]
- time: "2026-08-13T08:33:49.079Z"
  kind: "evidence"
  summary: "Confirmed view-control contract: the shared Structural renderer must honor the existing Changes diff preferences. Unified/side-by-side and wrap-versus-horizontal-scroll are renderer concerns and must produce equivalent behavior in Line and Structural. Hide whitespace remains a Git query concern, and flat/tree plus expand/collapse remain file-list concerns, not duplicated inside a per-file renderer. Expand/collapse may be independently owned by the file-list surface."
  source: "User direction and implementation verification, 2026-08-13"
