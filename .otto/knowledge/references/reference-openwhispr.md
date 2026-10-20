---
id: "reference-openwhispr"
kind: "reference"
title: "OpenWhispr"
status: "confirmed"
tags: ["external-reference", "legacy-references-migration"]
reference_disposition: "rejected"
source_url: "https://github.com/OpenWhispr/openwhispr"
created_at: "2026-08-08T06:18:17.872Z"
updated_at: "2026-08-08T06:20:05.149Z"
---

# OpenWhispr

<!-- compiled_truth -->

The user asked about embedding it. Rejected: it is a standalone Electron **end-user app**, not a library, so "including it" means shipping a second desktop app inside Otto; and its STT is the same `whisper.cpp` + `sherpa-onnx` Parakeet Otto already runs, so it would not improve transcription at all. **The one idea worth taking** - an optional LLM post-processing pass that punctuates and cleans the transcript - Otto is better positioned to do, because the daemon already has every provider wired up including the user's local LM Studio. Squarely the fork thesis.

## Timeline

- time: "2026-08-08T06:18:17.872Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T06:18:17.872Z"
  kind: "evidence"
  summary: "Migrated from `docs/references.md` (table row 439). Legacy status: Considered and rejected."
- time: "2026-08-08T06:20:05.149Z"
  kind: "note"
  summary: "Migrated from the repository's existing authoritative project or reference documentation at the user's request. New status: confirmed."
