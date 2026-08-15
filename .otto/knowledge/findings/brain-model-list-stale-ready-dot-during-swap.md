---
id: "brain-model-list-stale-ready-dot-during-swap"
kind: "finding"
title: "Brain model list could retain a stale ready dot during a model swap"
status: "confirmed"
tags: ["brain", "models", "lifecycle", "ui", "finding"]
created_at: "2026-08-15T04:27:57.768Z"
updated_at: "2026-08-15T04:27:57.768Z"
---

# Brain model list could retain a stale ready dot during a model swap

<!-- compiled_truth -->

During the interval after the old resident model stops and before the new model enters loading, the Models UI fell back to its cached inventory row state. That left the old model's ready dot visible despite the host reporting a non-ready supervisor state. The live status must be authoritative for its reported model throughout the entire lifecycle transition.

## Timeline

- time: "2026-08-15T04:27:57.768Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-all-model-operations-share-scheduler"]
- time: "2026-08-15T04:27:57.768Z"
  kind: "evidence"
  summary: "User observation, 2026-08-14. Root cause verified in packages/app/src/screens/brain/models-tab.tsx: displayModelState fell back to cached inventory state when modelId matched but state was stopped."
