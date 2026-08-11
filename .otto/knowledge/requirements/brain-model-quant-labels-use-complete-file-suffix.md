---
id: "brain-model-quant-labels-use-complete-file-suffix"
kind: "requirement"
title: "Brain model quant labels use complete file suffix"
status: "confirmed"
tags: ["brain", "models", "quant", "inventory"]
created_at: "2026-08-11T21:20:37.253Z"
updated_at: "2026-08-11T21:51:42.721Z"
---

# Brain model quant labels use complete file suffix

<!-- compiled_truth -->

Brain must derive a downloaded GGUF's Quant column from its complete terminal quant suffix, preserving extended variants such as `Q2_K_XL`. Source filename qualifiers such as `UD-` are not part of the user-facing quant label and must be removed. The Brain scanner removes the qualifier from newly scanned models, and the Models table removes it at render time so stale inventory from an older daemon is also displayed correctly. It must not show a blank label for a valid quant or truncate it to a shorter embedded token.

## Timeline

- time: "2026-08-11T21:20:37.253Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-11T21:20:37.253Z"
  kind: "evidence"
  summary: "User-reported Brain Models table regressions on 2026-08-11: `Muse-Glimmer-30B-UD-Q4_K_XL.gguf` rendered blank, while `Muse-Glimmer-30B-UD-Q2_K_XL.gguf` rendered `Q2_K`."
- time: "2026-08-11T21:47:43.097Z"
  kind: "decision"
  summary: "Explicit user correction, 2026-08-11: remove the `UD-` prefix that began appearing in quant names after the missing-quant repair."
  source: "User direction, 2026-08-11"
- time: "2026-08-11T21:47:48.602Z"
  kind: "note"
  summary: "The user explicitly corrected the required displayed quant-label behavior on 2026-08-11. New status: confirmed."
- time: "2026-08-11T21:51:42.721Z"
  kind: "decision"
  summary: "The user reported that a currently running Models table still rendered stale `UD-` values after the scanner fix, requiring normalization at the display boundary as well."
  source: "User report and implementation, 2026-08-11"
