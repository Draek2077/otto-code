---
id: "brain-catalog-uses-plain-model-names-and-prose"
kind: "requirement"
title: "Brain catalog uses plain model names and user-facing descriptions"
status: "confirmed"
tags: ["brain", "model-catalog", "ux", "copy"]
created_at: "2026-08-11T06:03:06.282Z"
updated_at: "2026-08-14T15:19:23.938Z"
---

# Brain catalog uses plain model names and user-facing descriptions

<!-- compiled_truth -->

The Brain download catalog presents each model with a readable display name, a title-cased category, concise capability metadata, and plain prose describing what the model is good at. Descriptions must not prescribe Otto commands, discuss quantization or VRAM headroom, include source-selection trivia, or use em dashes. The model identifier and download source remain technical implementation metadata and are not changed merely to improve display copy.

Catalog fallback artifacts use `Q4_K_M` whenever the source repository offers that quantization. A model whose source does not offer `Q4_K_M` retains the closest appropriate source format. The fallback never overrides the user’s quant selection in the Brain Library.

On wide panes, every section of the Brain Library tab respects the user’s selected chat width, matching the Metrics usage-and-cost ledger: it caps at the configured width and centers itself. It remains full width on smaller panes.

Otto-curated catalog records are authoritative by their stable download ID. On catalog load after an Otto update, the shipped seed replaces every curated record so corrected names, descriptions, and metadata reach existing installations. User-added records whose IDs are not in the seed or the explicit retired-ID list remain intact. When a curated model changes download source or is replaced, its seed entry declares the retired catalog IDs it supersedes. The loader removes those stale entries rather than displaying obsolete duplicates. Display names are never migration keys.

## Timeline

- time: "2026-08-11T06:03:06.282Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-11T06:03:06.282Z"
  kind: "evidence"
  summary: "User direction, 2026-08-10: clean up catalog naming and descriptions; remove npm instructions and strange hardware details; explain what each model is good at in helpful prose without em dashes."
- time: "2026-08-11T06:39:16.752Z"
  kind: "decision"
  summary: "User identified that the updated repository seed did not appear in the latest Dev build because existing persisted catalogs retained old curated entries. The upgrade migration now refreshes curated records while preserving user-added records."
  source: "User direction and implementation verification, 2026-08-11."
- time: "2026-08-11T06:42:23.716Z"
  kind: "decision"
  summary: "The active Dev catalog contained an old Qwen-hosted predecessor of Qwen3 Coder 30B A3B. Its ID differed from the canonical Unsloth entry, so it was mistakenly preserved as user-added and rendered duplicate legacy copy. The canonical entry now declares the retired ID and migration removes it."
  source: "Active Dev catalog audit and user report, 2026-08-11."
- time: "2026-08-11T06:46:03.694Z"
  kind: "decision"
  summary: "User direction, 2026-08-11: make the Brain catalog use the same selected-width behavior as the Metrics usage-and-cost ledger."
  source: "User request, 2026-08-11."
- time: "2026-08-11T06:49:20.179Z"
  kind: "decision"
  summary: "User clarification, 2026-08-11: the selected-width treatment applies to every Library tab section, not only the curated catalog card."
  source: "User clarification, 2026-08-11."
- time: "2026-08-14T15:08:16.625Z"
  kind: "evidence"
  summary: "Added `unsloth/Qwen3.8-27B-GGUF` to the official Brain catalog alongside Qwen3.6 27B. The verified Q5_K_M artifact is 19,834,054,624 bytes, with a 262,144-token context window and optional `mmproj-F16.gguf` image-understanding component. Catalog source and candidate-model documentation now match; targeted catalog test, Brain typecheck, package lint, and formatting passed."
  source: "User direction and Hugging Face repository audit, 2026-08-14."
- time: "2026-08-14T15:19:23.938Z"
  kind: "decision"
  summary: "The user established the quant-selection policy for catalog fallback artifacts."
  source: "User direction, 2026-08-14."
