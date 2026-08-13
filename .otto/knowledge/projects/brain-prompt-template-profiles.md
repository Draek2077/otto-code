---
id: "brain-prompt-template-profiles"
kind: "project"
title: "Brain prompt and chat-template profiles"
status: "confirmed"
tags: ["otto-brain", "llama-server", "model-settings", "qwen"]
delivery_status: "in_build"
progress_completed: 3
progress_total: 4
progress_unit: "delivery slices"
created_at: "2026-08-12T03:08:05.054Z"
updated_at: "2026-08-13T07:36:59.189Z"
---

# Brain prompt and chat-template profiles

<!-- compiled_truth -->

## Outcome

Give Otto Brain a first-class library of named, reusable system-prompt and Jinja chat-template profiles. Users opt in per model family, choose a named profile from a dropdown in the model settings, and can override the inherited family choice on an individual model. Off remains the default.

## Storage and transport

Profiles are stored by the Brain under `$OTTO_HOME/otto-brain/`, served by Brain's authenticated host API, proxied by the daemon, and rendered by the app. The app must never own the source of truth.

## Application

A selected template is materialized as a Brain-owned file and passed to the active `llama-server` process via `--chat-template-file`; changing it is pending until the next model load. A selected prompt is composed by the selected template with Otto's agent-owned system prompt, never silently replacing it.

## Scope

- Named profiles with family targets and per-model override.
- Explicit enable toggle; disabled uses the GGUF template unchanged.
- Read, create, edit, duplicate, delete, select, and effective-resolution preview.
- Rendered-prompt/test request before activation.
- Compatible, additive daemon protocol and host API.

## Non-goals

- Editing GGUF metadata.
- A generic local prompt library unrelated to hosting behavior.
- Mutating a running `llama-server`; profile changes apply on reload.

## Acceptance criteria

- Qwen-family model can opt into a named template/profile and the launched command demonstrably uses it.
- The original Otto/agent system prompt and selected addendum compose in the documented order.
- A model without an enabled override continues using its embedded template.
- Remote Brain owners manage the same data through authenticated control, with no client-side persistence fork.
- The UI shows inheritance, source, and reload-required state clearly.

## Timeline

- time: "2026-08-12T03:08:05.054Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["qwen-sharp-chat-templates"]
- time: "2026-08-12T03:08:05.054Z"
  kind: "evidence"
  summary: "Verified against llama.cpp server documentation on 2026-08-11: llama-server supports `--chat-template-file`, `--chat-template-kwargs`, Jinja templates, system messages, tool-call parsing, and `/apply-template`. Current Brain already has a per-model profile store, an authenticated host API proxied through the daemon, and `buildArgs()` as its server-launch boundary."
- time: "2026-08-12T03:15:23.318Z"
  kind: "note"
  summary: "User explicitly approved the Brain-owned named profile model, family defaults, per-model opt-in overrides, custom profile dialog, and implementation. New status: confirmed."
- time: "2026-08-12T03:15:24.226Z"
  kind: "note"
  summary: "Implementation begins with Brain persistence/host API, then daemon/protocol relay, model-settings UI, and targeted verification."
  affects: ["brain-prompt-template-profiles"]
- time: "2026-08-12T03:20:04.461Z"
  kind: "note"
  summary: "Brain profile persistence now records reload-required state per resident model, returns it when model settings reopen, and clears it only after a successful model load. Hosting-profile storage and launcher materialization groundwork is also in place; UI and protocol surface remain."
  affects: ["brain-prompt-template-profiles"]
- time: "2026-08-13T07:20:28.233Z"
  kind: "evidence"
  summary: "Repaired the shipped Qwen Sharp built-in hosting profile: the exact Apache-2.0 upstream template is vendored as Brain-owned base64 text, preserving `preserve_thinking: false`. Built-in product ids now replace stale records wholesale on load while unknown user-created ids survive. A fresh read keeps the seeded profile in memory without creating `profiles.json`; existing stores are written only when an upgrade changes the built-in, avoiding read-only CLI writes racing the running service snapshot. Targeted hosting-profile tests, Brain build, lint, typecheck, and formatting passed."
  source: "Commit e6d4917b4; packages/brain/src/config/builtin-hosting-profiles.ts and store.ts"
- time: "2026-08-13T07:27:18.799Z"
  kind: "note"
  summary: "Centralized hosting-profile materialization in Supervisor.start, wired local bench completions through the scheduler for system-addendum injection, and added focused launch-boundary coverage; Brain typecheck, lint, formatting, and targeted tests pass."
  affects: ["brain-prompt-template-profiles"]
- time: "2026-08-13T07:33:52.064Z"
  kind: "note"
  summary: "Committed GGUF metadata family derivation for uncurated models. Catalog families remain authoritative; Qwen architecture variants normalize into the existing qwen hosting-profile bucket. Focused enrichment tests and required lint, formatting, and typechecks pass."
  affects: ["brain-prompt-template-profiles"]
- time: "2026-08-13T07:36:59.189Z"
  kind: "evidence"
  summary: "Closed five Brain model-profile write-path validation and hygiene gaps: multiplier-only edits re-clamp context and correctly invalidate calibration only on an actual change; component minimum llama.cpp build requirements are enforced server-side and surfaced as unavailable inventory rows; hosting-profile update ids are collision-safe and product-owned presets are immutable; profile count is capped; deleting a profile removes its materialized template best-effort. Targeted Brain tests, formatting, lint, and typecheck passed; the commit hook also passed workspace typecheck."
  source: "Commit 63c338c1e; packages/brain/src/config/profile-edit.ts, service/host-api.ts, config/hosting-profiles.ts"
