---
id: "managed-llama-runtime-build-selection"
kind: "requirement"
title: "Managed llama.cpp build selection"
status: "confirmed"
tags: ["brain", "llama.cpp", "runtime", "local-ai"]
created_at: "2026-08-11T00:47:29.211Z"
updated_at: "2026-08-11T00:48:06.417Z"
---

# Managed llama.cpp build selection

<!-- compiled_truth -->

Otto Brain must let users browse and install any compatible official llama.cpp release build, including resolving and installing the latest available build. It must preserve installed runtimes for rollback and allow cleanup of unused Otto-managed runtimes while protecting the active runtime and never modifying LM Studio-owned files.

## Timeline

- time: "2026-08-11T00:47:29.211Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-11T00:47:29.211Z"
  kind: "evidence"
  summary: "User requirement, 2026-08-10."
- time: "2026-08-11T00:48:06.417Z"
  kind: "decision"
  summary: "User added explicit cleanup requirement, 2026-08-10."
  source: "User requirement, 2026-08-10."
