---
id: "brain-overview-top-tiles-share-height"
kind: "requirement"
title: "Brain Overview top tiles share height"
status: "confirmed"
tags: ["brain", "overview", "layout", "ui"]
created_at: "2026-08-15T03:21:17.905Z"
updated_at: "2026-08-15T03:21:17.905Z"
---

# Brain Overview top tiles share height

<!-- compiled_truth -->

When the Brain Overview server and runtime tiles render side by side, they share one row height and each tile fills it. At extra-compact widths they stack and retain their natural heights.

## Timeline

- time: "2026-08-15T03:21:17.905Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-15T03:21:17.905Z"
  kind: "evidence"
  summary: "User-reported visual regression on 2026-08-14, confirmed against the prior implementation: the row used `alignItems: \"stretch\"` and both tiles used the shared `fillHeight` style."
