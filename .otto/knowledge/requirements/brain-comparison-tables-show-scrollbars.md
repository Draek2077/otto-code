---
id: "brain-comparison-tables-show-scrollbars"
kind: "requirement"
title: "Brain comparison tables show scrollbars"
status: "proposed"
tags: ["brain", "models", "benchmarks", "scrollbar", "ui"]
created_at: "2026-08-11T17:40:37.508Z"
updated_at: "2026-08-11T17:43:44.993Z"
---

# Brain comparison tables show scrollbars

<!-- compiled_truth -->

Overflowing comparison tables in Brain, including Models and Benchmarks, must show Otto's themed scrollbar on web while retaining the platform scrollbar on native. Scrolling must remain functional and the scrollbar must be scoped to the table's own scroll region.

## Timeline

- time: "2026-08-11T17:40:37.508Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-11T17:40:37.508Z"
  kind: "evidence"
  summary: "User direction, 2026-08-11. The Models table scrolled on web but had no visible scrollbar; matching benchmark tables used the same web-hidden indicator pattern."
- time: "2026-08-11T17:43:44.993Z"
  kind: "evidence"
  summary: "Scrollbar alignment correction: the themed overlay is now mounted in a wrapper containing only the rows ScrollView, below the pinned header, so its track starts at the row viewport rather than the table border."
  source: "User feedback and implementation, 2026-08-11"
