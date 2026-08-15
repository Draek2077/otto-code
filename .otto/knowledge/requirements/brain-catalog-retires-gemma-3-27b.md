---
id: "brain-catalog-retires-gemma-3-27b"
kind: "requirement"
title: "Brain catalog retires Gemma 3 27B"
status: "confirmed"
tags: ["brain", "model-catalog", "gemma", "curation"]
created_at: "2026-08-14T19:36:29.546Z"
updated_at: "2026-08-14T19:37:44.653Z"
---

# Brain catalog retires Gemma 3 27B

<!-- compiled_truth -->

Gemma 3 27B is not retained in the curated Brain catalog. Its stable catalog IDs are explicitly retired so catalog refresh removes the row from existing installations while leaving downloaded model files untouched.

## Timeline

- time: "2026-08-14T19:36:29.546Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-14T19:36:29.546Z"
  kind: "evidence"
  summary: "User direction, 2026-08-14."
- time: "2026-08-14T19:37:44.653Z"
  kind: "evidence"
  summary: "Removed Gemma 3 27B from the seed, placed its stable download ID in `retiredModelIds`, and refreshed the Dev catalog. The Dev daemon verifies Gemma 3 absent and Gemma 4 E4B present. Focused migration test, Brain build/typecheck, and lint passed."
  source: "Implementation verification, 2026-08-14."
