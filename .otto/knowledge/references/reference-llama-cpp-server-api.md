---
id: "reference-llama-cpp-server-api"
kind: "reference"
title: "llama.cpp server API"
status: "confirmed"
tags: ["external-reference", "legacy-references-migration"]
reference_disposition: "dependency"
source_url: "https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md"
created_at: "2026-08-08T06:18:12.937Z"
updated_at: "2026-08-08T06:20:01.048Z"
---

# llama.cpp server API

<!-- compiled_truth -->

The `/slots` contract for Otto Brain live inference telemetry. Its current response nests `n_decoded` under `next_token`, while older builds used top-level counters; host API v2 accepts both and bounds sampling independently of model token rate. The documented reasoning/content streaming fields define the live `thinking` to `generating` boundary.

## Timeline

- time: "2026-08-08T06:18:12.937Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T06:18:12.937Z"
  kind: "evidence"
  summary: "Migrated from `docs/references.md` (table row 383). Legacy status: Dependency (embedded runtime)."
- time: "2026-08-08T06:20:01.048Z"
  kind: "note"
  summary: "Migrated from the repository's existing authoritative project or reference documentation at the user's request. New status: confirmed."
