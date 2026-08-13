---
id: "brain-model-profile-and-prompt-template-profile-terminology"
kind: "decision"
title: "Brain distinguishes model profiles from prompt & template profiles"
status: "proposed"
tags: ["otto-brain", "terminology", "model-profile", "prompt-template-profile"]
created_at: "2026-08-13T07:40:37.168Z"
updated_at: "2026-08-13T07:40:37.168Z"
---

# Brain distinguishes model profiles from prompt & template profiles

<!-- compiled_truth -->

Otto Brain uses **Model profile** for the per-model launch and VRAM settings, including context, KV cache types, flash attention, GPU layers, parallel slots, and reasoning budget. It uses **Prompt & template profile** for the named Brain-owned, family-bucketed record that supplies a Jinja chat template, template kwargs, and an optional system-prompt addendum.

The UI label wins. Documentation must not call either concept a "hosting profile" or use bare "profile" where the referent is ambiguous. Existing wire and persisted code identifiers (`HostingProfile`, `hostingProfileId`, `hostingProfileMode`, and `familyHostingProfileIds`) remain unchanged for now because they cross the backward-compatible protocol boundary.

## Timeline

- time: "2026-08-13T07:40:37.168Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-prompt-template-profiles"]
- time: "2026-08-13T07:40:37.168Z"
  kind: "evidence"
  summary: "User-directed terminology settlement on 2026-08-13. Verified against docs/brain.md, docs/glossary.md, packages/brain/src/config/schema.ts, packages/protocol/src/messages.ts, and packages/app/src/screens/brain/profile-editor.tsx, whose UI says \"Prompt & template\" and \"Prompt & template profiles\"."
