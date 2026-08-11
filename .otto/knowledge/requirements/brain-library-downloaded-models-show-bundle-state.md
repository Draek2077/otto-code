---
id: "brain-library-downloaded-models-show-bundle-state"
kind: "requirement"
title: "Brain Library downloaded models show bundle state"
status: "confirmed"
tags: ["brain", "library", "bundles", "inventory"]
created_at: "2026-08-11T19:44:39.542Z"
updated_at: "2026-08-11T19:44:39.542Z"
---

# Brain Library downloaded models show bundle state

<!-- compiled_truth -->

In Brain Library's Downloaded models section, a downloaded model that includes a detected vision projector is explicitly labeled as a Vision bundle. Ordinary downloaded Hugging Face models remain unlabeled because download state is already implied by the section.

## Timeline

- time: "2026-08-11T19:44:39.542Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-hugging-face-projector-bundle-discovery","brain-library-installed-models-exclude-catalog-artifacts"]
- time: "2026-08-11T19:44:39.542Z"
  kind: "evidence"
  summary: "User direction, 2026-08-11. Implemented from the daemon inventory's `hasProjector` state."
