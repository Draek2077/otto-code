---
id: "brain-catalog-qwen-curation"
kind: "requirement"
title: "Brain catalog curates two Qwen models"
status: "confirmed"
tags: ["brain","model-catalog","curation"]
created_at: "2026-08-14T19:28:03.137Z"
updated_at: "2026-08-14T19:30:26.811Z"
---
# Brain catalog curates two Qwen models

<!-- compiled_truth -->

The curated Brain catalog contains only two Qwen-branded models: Qwen3 Coder 30B A3B and Qwen3.8 27B. Qwen 2.5 Coder 32B, Qwen3 32B, Qwen3 30B A3B, and Qwen3.6 27B are retired curated entries. Their stable IDs must be explicitly retired so existing catalogs remove them while preserving genuinely user-added models.

## Timeline

- time: "2026-08-14T19:28:03.137Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-14T19:28:03.137Z"
  kind: "evidence"
  summary: "User direction and Library screenshot, 2026-08-14."
- time: "2026-08-14T19:30:26.811Z"
  kind: "evidence"
  summary: "Removed the four retired Qwen catalog rows from the seed and added `retiredModelIds` so persisted catalogs purge their Q4 and former Q5 stable IDs during refresh. Verified the Dev catalog now returns only Qwen3 Coder 30B A3B and Qwen3.8 27B among Qwen-branded models. Focused migration test, Brain build/typecheck, and targeted lint passed."
  source: "Implementation verification, 2026-08-14."
