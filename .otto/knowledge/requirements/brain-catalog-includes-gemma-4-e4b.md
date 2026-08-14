---
id: "brain-catalog-includes-gemma-4-e4b"
kind: "requirement"
title: "Brain catalog includes Gemma 4 E4B"
status: "confirmed"
tags: ["brain","model-catalog","gemma","bundles"]
created_at: "2026-08-14T19:32:54.745Z"
updated_at: "2026-08-14T19:34:35.276Z"
---
# Brain catalog includes Gemma 4 E4B

<!-- compiled_truth -->

The curated Brain catalog includes Gemma 4 E4B as a compact vision and audio-capable local model, with its optional image-understanding projector declared as a bundle component.

## Timeline

- time: "2026-08-14T19:32:54.745Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-14T19:32:54.745Z"
  kind: "evidence"
  summary: "User direction, 2026-08-14. Google’s Gemma 4 model card identifies E4B as an effective-4B model with 128K context, text/image/audio inputs, and configurable thinking; the audited Unsloth GGUF repository provides Q4_K_M and mmproj-F16 artifacts."
- time: "2026-08-14T19:34:35.276Z"
  kind: "evidence"
  summary: "Added `unsloth/gemma-4-E4B-it-GGUF` with `gemma-4-E4B-it-Q4_K_M.gguf` (4,977,171,584 bytes) and optional `mmproj-F16.gguf` (990,372,672 bytes). The Dev daemon catalog returns the entry with vision and thinking enabled. Focused catalog tests, Brain build/typecheck, and lint passed."
  source: "Google Gemma 4 model card and Unsloth GGUF repository audit, 2026-08-14."
