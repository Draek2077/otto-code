---
id: "language-support-grows-with-structural-diff"
kind: "requirement"
title: "Language support grows with structural diff"
status: "confirmed"
tags: ["languages", "syntax-highlighting", "diffs", "developer-experience"]
created_at: "2026-08-13T02:48:09.108Z"
updated_at: "2026-08-13T02:48:09.108Z"
---

# Language support grows with structural diff

<!-- compiled_truth -->

Otto's structural-diff project must not freeze the current syntax-highlighting/parser registry. Missing developer-relevant languages and structured formats are added deliberately to Otto's language support, then enter the same structural-diff corpus, confidence, safety, and performance contract as existing languages. A single authoritative language-capability registry must prevent an extension from being advertised as structural-capable without parser/highlighting support, or vice versa.

## Timeline

- time: "2026-08-13T02:48:09.108Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["structural-diff-review-experience","diff-review-experience"]
- time: "2026-08-13T02:48:09.108Z"
  kind: "evidence"
  summary: "User direction on 2026-08-13: expand language support promptly where Otto is missing languages it should support, and require those languages to participate in the structural-diff quality contract."
