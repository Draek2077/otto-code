---
id: "brain-model-settings-preserve-reasoning"
kind: "requirement"
title: "Brain model settings expose preserve reasoning when supported"
status: "confirmed"
tags: ["brain", "models", "reasoning", "qwen"]
created_at: "2026-08-14T19:16:56.816Z"
updated_at: "2026-08-14T19:27:31.825Z"
---

# Brain model settings expose preserve reasoning when supported

<!-- compiled_truth -->

Brain model settings expose a persisted Preserve reasoning toggle only when the selected model template declares support. The host owns the capability and applies the model template's native preservation argument; unsupported models expose no control. Qwen3.8 uses the `preserve_thinking` template argument.

## Timeline

- time: "2026-08-14T19:16:56.816Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-profile-selection-and-editor-ux","remote-brain-functionality-is-host-owned-and-connection-neutral"]
- time: "2026-08-14T19:16:56.816Z"
  kind: "evidence"
  summary: "User explicitly requested an enable/disable control in model settings. Qwen/Qwen3.8-27B Hugging Face model card and tokenizer_config.json document `preserve_thinking`; current llama.cpp reasoning preservation recognizes `preserve_reasoning` rather than Qwen's key."
- time: "2026-08-14T19:27:31.825Z"
  kind: "evidence"
  summary: "Implemented model-declared reasoning template controls for Qwen3.8 27B: catalog discovery now advertises low, medium, and xhigh with xhigh default; the host maps effort requests to enable_thinking/reasoning_effort; the profile editor and TUI conditionally expose Preserve reasoning, persist it, and launch llama-server with preserve_thinking. Focused Brain tests (85) and OpenAI-compatible provider tests (114), targeted lint, and workspace typecheck passed."
  source: "Implementation and focused verification, 2026-08-14"
  affects: ["brain-profile-selection-and-editor-ux","remote-brain-functionality-is-host-owned-and-connection-neutral"]
