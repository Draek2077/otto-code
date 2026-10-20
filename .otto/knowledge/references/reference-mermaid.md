---
id: "reference-mermaid"
kind: "reference"
title: "Mermaid"
status: "confirmed"
tags: ["external-reference", "legacy-references-migration"]
reference_disposition: "dependency"
source_url: "https://mermaid.js.org"
created_at: "2026-08-08T06:18:14.069Z"
updated_at: "2026-08-16T13:43:02.485Z"
---

# Mermaid

<!-- compiled_truth -->

Diagram fences on all four platforms. Web/Electron import it lazily (~3.4 MB); iOS/Android run the same render core in a self-contained webview payload. Was also the diagram layer of the (now retired) `archdocs/` site.

## Timeline

- time: "2026-08-08T06:18:14.069Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T06:18:14.069Z"
  kind: "evidence"
  summary: "Migrated from `docs/references.md` (table row 394). Legacy status: Dependency (lazy + vendored webview)."
- time: "2026-08-08T06:20:02.226Z"
  kind: "note"
  summary: "Migrated from the repository's existing authoritative project or reference documentation at the user's request. New status: confirmed."
- time: "2026-08-16T13:43:02.485Z"
  kind: "decision"
  summary: "Retiring archdocs/: the \"Also the diagram layer of archdocs/\" clause now reads \"Was also the diagram layer of the (now retired) archdocs/ site\" so the pointer does not imply the site still exists. No other content changed."
