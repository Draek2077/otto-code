---
id: "brain-log-source-and-operation-tags"
kind: "requirement"
title: "Brain logs distinguish source and operation"
status: "confirmed"
tags: ["brain", "logging", "observability", "llama-server"]
created_at: "2026-08-15T03:52:02.085Z"
updated_at: "2026-08-15T04:05:24.294Z"
---

# Brain logs distinguish source and operation

<!-- compiled_truth -->

Every current Brain service-session row begins with a durable source tag: `[brain]` for Otto Brain work or `[llama-server]` for managed llama.cpp child output. Brain rows also carry exactly one operation tag: `[library]`, `[model]`, `[api]`, or `[server]`. The session timestamp is compact `HH:mm:ss.SSS` with no date or timezone. llama-server rows remove its repetitive elapsed-time, severity-letter and component columns, preserving only the useful message after `[llama-server]`. The Logs tab colors only `[brain]` and `[llama-server]` distinctly.

## Timeline

- time: "2026-08-15T03:52:02.085Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-console","brain-operations-use-resident-hosted-server"]
- time: "2026-08-15T03:52:02.085Z"
  kind: "evidence"
  summary: "Explicit user requirement, 2026-08-15: distinguish Brain and llama-server logs with colored front-of-line tags and identify every Brain operation by Library, Model, API, or Server."
- time: "2026-08-15T03:53:37.584Z"
  kind: "evidence"
  summary: "Implemented source-first durable log entries and tag-only UI coloring. `llama-server` stdout/stderr is preserved as `[llama-server]`; host-owned entries use `[brain]` with `[library]`, `[model]`, `[api]`, or `[server]`. Instrumentation covers catalog/Hugging Face actions, model profile and lifecycle actions, host jobs, completion queue lifecycle, and service lifecycle/restarts. Focused service and renderer tests passed, as did targeted lint plus Brain and app typechecks."
  source: "Implementation verification, 2026-08-15"
- time: "2026-08-15T04:05:24.294Z"
  kind: "decision"
  summary: "The user explicitly refined the tagged-log contract to remove redundant date/time and llama.cpp machine columns while retaining source and operation context."
  affects: ["brain-console","brain-operations-use-resident-hosted-server"]
