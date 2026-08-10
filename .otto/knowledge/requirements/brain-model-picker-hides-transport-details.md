---
id: "brain-model-picker-hides-transport-details"
kind: "requirement"
title: "Brain model picker hides transport details"
status: "proposed"
tags: ["ui", "brain", "model-picker", "error-handling"]
created_at: "2026-08-10T00:34:26.368Z"
updated_at: "2026-08-10T00:34:26.368Z"
---

# Brain model picker hides transport details

<!-- compiled_truth -->

When Otto Brain's model list cannot be loaded because the configured endpoint is unreachable, the model picker should show a concise connection status and recovery guidance rather than embedding the endpoint URL and transport failure in its primary message.

## Timeline

- time: "2026-08-10T00:34:26.368Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-10T00:34:26.368Z"
  kind: "evidence"
  summary: "User reported the raw endpoint and '(fetch failed)' presentation in the Otto Brain model picker on 2026-08-09. Implemented as a proposed interpretation in packages/app/src/provider-selection/provider-selection.ts and both model picker variants."
