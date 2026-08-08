---
id: "reference-langgraph"
kind: "reference"
title: "LangGraph"
status: "confirmed"
tags: ["external-reference", "legacy-references-migration"]
reference_disposition: "read"
source_url: "https://github.com/langchain-ai/langgraph"
created_at: "2026-08-08T06:18:06.025Z"
updated_at: "2026-08-08T06:19:55.599Z"
---

# LangGraph

<!-- compiled_truth -->

**Read, not linked** | The science of durable agent graphs. **Taken as concepts:** checkpoint-after-every-step, interrupt/resume, conditional edges + router, `Send` dynamic fan-out (our Map node), subgraphs, per-node retry + recursion limit. **Skipped:** shared typed state + reducers (artifacts are files; the filesystem already has ownership semantics), `Command` update+goto (that is the model taking control back from the user), deterministic replay + saga compensation (git is our compensation mechanism). **Not linked because** its node is an in-process function returning a state delta in milliseconds; ours spawns an OS process that edits a real repo for minutes to hours. Also: `Run` is a protocol type with back-compat guarantees, so a second state model would have to be projected into it anyway.

## Timeline

- time: "2026-08-08T06:18:06.025Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T06:18:06.025Z"
  kind: "evidence"
  summary: "Migrated from `docs/references.md` (table row 300). Legacy status: MIT."
- time: "2026-08-08T06:19:55.599Z"
  kind: "note"
  summary: "Migrated from the repository's existing authoritative project or reference documentation at the user's request. New status: confirmed."
