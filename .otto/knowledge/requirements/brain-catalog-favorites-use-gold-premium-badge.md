---
id: "brain-catalog-favorites-use-gold-premium-badge"
kind: "requirement"
title: "Brain catalog favorites use a gold premium badge"
status: "confirmed"
tags: ["brain", "model-catalog", "ux"]
created_at: "2026-08-14T18:50:52.629Z"
updated_at: "2026-08-14T18:55:35.376Z"
---

# Brain catalog favorites use a gold premium badge

<!-- compiled_truth -->

The curated Brain catalog owns an optional boolean `favorite` property. When `favorite` is true, the Brain Library displays a gold `workspace_premium` icon directly to the right of the model name. Muse Glimmer and Qwen 3.8 27B are initially marked as favorites. The rating is decorative and does not affect download, profile, runtime, or sorting behavior.

## Timeline

- time: "2026-08-14T18:50:52.629Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-14T18:50:52.629Z"
  kind: "evidence"
  summary: "User direction, 2026-08-14."
- time: "2026-08-14T18:55:35.376Z"
  kind: "evidence"
  summary: "Implemented the catalog-to-Library favorite path: CatalogModel defaults missing favorite values to false, the catalog command and backward-compatible protocol schema carry it, and the Library conditionally renders the existing gold workspace_premium glyph. Muse Glimmer 30B and Qwen3.8 27B are marked true in the curated seed. Focused catalog test, package builds, Brain/protocol/server/app typechecks, and targeted lint passed."
  source: "Implementation verification, 2026-08-14."
