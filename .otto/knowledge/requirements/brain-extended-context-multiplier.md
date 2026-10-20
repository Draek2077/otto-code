---
id: "brain-extended-context-multiplier"
kind: "requirement"
title: "Brain extended context uses a per-model context multiplier"
status: "confirmed"
tags: ["otto-brain", "context", "rope", "yarn", "profiles", "calibration"]
created_at: "2026-08-12T02:57:29.436Z"
updated_at: "2026-08-12T02:57:29.436Z"
---

# Brain extended context uses a per-model context multiplier

<!-- compiled_truth -->

Otto Brain exposes extended RoPE context as a per-model **Context multiplier** selector. The selected multiplier defines the model profile's maximum permissible Context value and the maximum Context considered by calibration. `Off` preserves the GGUF-native context ceiling; selecting a multiplier enables the corresponding vetted RoPE extension configuration and permits any Context allocation up to native context × multiplier. Parallel slots still divide the allocated Context per concurrent request. Extended-context configurations must remain visibly distinct from native context because quality beyond the GGUF-native window is extrapolative and calibration results are configuration-specific.

## Timeline

- time: "2026-08-12T02:57:29.436Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-12T02:57:29.436Z"
  kind: "evidence"
  summary: "User-confirmed product direction, 2026-08-11: “Context multiplier” is selected from a dropdown; it sets the new maximum permitted by the Context size picker and Calibrate."
