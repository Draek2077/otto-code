---
id: "reference-language-server-protocol"
kind: "reference"
title: "Language Server Protocol"
status: "confirmed"
tags: ["external-reference", "legacy-references-migration"]
reference_disposition: "adopted"
source_url: "https://microsoft.github.io/language-server-protocol/"
created_at: "2026-08-08T06:18:15.693Z"
updated_at: "2026-08-08T06:20:03.481Z"
---

# Language Server Protocol

<!-- compiled_truth -->

The daemon's LSP client. Empirically probed rather than trusted: `typescript-language-server` 5.3 sends no `serverInfo`, and the spec **forbids** a server sending `$/progress` unless the client advertised `window.workDoneProgress` - both recorded in [code-intelligence.md](code-intelligence.md).

## Timeline

- time: "2026-08-08T06:18:15.693Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T06:18:15.693Z"
  kind: "evidence"
  summary: "Migrated from `docs/references.md` (table row 409). Legacy status: Implemented (client)."
- time: "2026-08-08T06:20:03.481Z"
  kind: "note"
  summary: "Migrated from the repository's existing authoritative project or reference documentation at the user's request. New status: confirmed."
