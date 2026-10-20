---
id: "structural-diff-parser-backed-migration-proposal"
kind: "architecture"
title: "Parser-backed structural DiffDocument migration"
status: "proposed"
tags: []
created_at: "2026-08-13T01:38:05.166Z"
updated_at: "2026-08-13T01:38:05.166Z"
---

# Parser-backed structural DiffDocument migration

<!-- compiled_truth -->

Propose replacing the flat structural prototype with a per-file canonical DiffDocument whose lines retain source identity, hunk coordinates, old/new locations, syntax tokens and segments, and per-side ReviewableDiffTarget values. Both Line and Structural renderers consume this document; surface wrappers retain their domain-owned actions. Structural alignment should reuse Otto's existing @otto-code/highlight Lezer parser registry, parse reconstructed old/new hunk source, and align only unambiguous AST anchors plus exact line anchors. It must never greedily pair similar text. Unsupported, malformed, binary, oversized, truncated, or source-incomplete documents resolve to the complete Line renderer through typed capability states and i18n reason codes. Initial migration remains client-side over ParsedDiffFile and existing before/after data; no protocol change is required.

## Timeline

- time: "2026-08-13T01:38:05.166Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["structural-diff-review-experience","diff-review-experience"]
- time: "2026-08-13T01:38:05.166Z"
  kind: "evidence"
  summary: "Plan authored from the 2026-08-12 current-diff-topology audit. Existing packages/highlight already provides @lezer parsers and getParserForFile, so this proposal needs no external tool installation. Confirmation is required before treating it as current architecture."
