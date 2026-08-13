---
id: "diff-visual-language-is-syntax-palette-owned"
kind: "requirement"
title: "Diff visual language is syntax-palette-owned"
status: "confirmed"
tags: ["diff", "syntax-highlighting", "themes"]
created_at: "2026-08-13T05:10:47.073Z"
updated_at: "2026-08-13T05:10:47.073Z"
---

# Diff visual language is syntax-palette-owned

<!-- compiled_truth -->

All diff rendering colors, including added and removed row tints, intraline emphasis, formatting, moved code, added and removed foregrounds, markers, coordinates, and diff statistics, are resolved from the active syntax palette. Application status and fixed GitHub colors do not define diff semantics. Every syntax theme supplies the complete palette.

## Timeline

- time: "2026-08-13T05:10:47.073Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["structural-diff-review-experience","diff-review-experience"]
- time: "2026-08-13T05:10:47.073Z"
  kind: "evidence"
  summary: "Explicit user decision: use palette colors for all diff elements and add any missing palette colors."
