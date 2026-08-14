---
id: "brain-template-preservation-detection"
kind: "requirement"
title: "Brain normalizes template reasoning-preservation support"
status: "confirmed"
tags: ["brain", "models", "reasoning", "template-discovery"]
created_at: "2026-08-14T19:35:45.269Z"
updated_at: "2026-08-14T19:39:02.362Z"
---

# Brain normalizes template reasoning-preservation support

<!-- compiled_truth -->

Brain detects `preserve_thinking` and `preserve_reasoning` in a model's GGUF chat template and normalizes either spelling to one Preserve reasoning model-setting capability. The host retains the detected native argument when launching the model; explicit catalog metadata remains authoritative.

## Timeline

- time: "2026-08-14T19:35:45.269Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-model-settings-preserve-reasoning","brain-profile-selection-and-editor-ux"]
- time: "2026-08-14T19:35:45.269Z"
  kind: "evidence"
  summary: "User explicitly requested a single capability mapping for both native template spellings."
- time: "2026-08-14T19:39:02.362Z"
  kind: "evidence"
  summary: "Implemented GGUF chat-template detection for both `preserve_thinking` and `preserve_reasoning`. Model enrichment normalizes either detected native argument into one `reasoningPreservation` capability, while explicit catalog metadata wins when available. The Preserve reasoning profile control, TUI, and launcher consume that normalized capability; the per-request effort template remains separate. Focused Brain tests (94), targeted lint, and workspace typecheck passed."
  source: "Implementation and focused verification, 2026-08-14"
  affects: ["brain-model-settings-preserve-reasoning","brain-profile-selection-and-editor-ux"]
