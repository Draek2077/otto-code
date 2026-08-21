---
id: "brain-model-family-icons"
kind: "requirement"
title: "Otto Brain model family icons"
status: "confirmed"
tags: ["otto-brain","model-catalog","ui","icons"]
created_at: "2026-08-12T00:53:44.575Z"
updated_at: "2026-08-21T18:42:02.875Z"
---
# Otto Brain model family icons

<!-- compiled_truth -->

The Otto Brain UI renders professional, monochrome, colorizable SVG icons for catalog-owned model families, including recognized installed variants of curated models. It must not infer family identity broadly from arbitrary Hugging Face search results. Variant models inherit their curated base family icon unless explicitly assigned a different family. Brand artwork is sourced from LobeHub lobe-icons where a suitable mark exists; Muse Glimmer uses Meta, and the catalogued Ornith 1.0 35B MoE uses Qwen because its base architecture is Qwen 3.5. In the Models table, the family icon is the single lifecycle marker: it uses a muted color when idle, the serving green when the model is loaded or actively serving, and a same-sized loading spinner replaces it for every busy lifecycle or model-operation state before the family icon returns.

## Timeline

- time: "2026-08-12T00:53:44.575Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-12T00:53:44.575Z"
  kind: "evidence"
  summary: "User requirement, 2026-08-11. Implementation seam verified in packages/brain/config/downloads.json, packages/brain/src/commands/catalog.ts, packages/brain/src/models/enrich.ts, and Brain model/catalog UI components."
- time: "2026-08-12T01:55:07.704Z"
  kind: "evidence"
  summary: "The user rejected the first pass of purpose-drawn generic glyphs as not recognizable or professional enough. Replacement direction must use genuinely identifiable family marks, prioritizing official source artwork or faithful normalized adaptations."
  source: "User feedback, 2026-08-11"
  affects: ["brain-model-family-icons"]
- time: "2026-08-12T02:02:35.052Z"
  kind: "decision"
  summary: "The user selected LobeHub as the source for recognizable SVGs and explicitly chose Meta for Muse Glimmer."
  source: "User direction, 2026-08-11; https://github.com/lobehub/lobe-icons"
  affects: ["brain-model-family-icons"]
- time: "2026-08-12T02:03:39.159Z"
  kind: "decision"
  summary: "The user clarified that Ornith should use its base-model family. Verified the catalogued 35B MoE checkpoint is Qwen 3.5-based."
  source: "User direction, 2026-08-11; https://www.ornith.site/blog/deepreinforce-ai/"
  affects: ["brain-model-family-icons"]
- time: "2026-08-21T18:42:02.875Z"
  kind: "decision"
  summary: "User direction on 2026-08-21 and verified implementation in packages/app/src/screens/brain/models-tab.tsx make the model-family icon the sole table-row lifecycle marker, with a same-sized spinner during busy states."
  source: "User direction and implementation, 2026-08-21"
