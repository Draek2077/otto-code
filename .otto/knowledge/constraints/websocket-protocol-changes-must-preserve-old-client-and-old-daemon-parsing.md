---
id: "websocket-protocol-changes-must-preserve-old-client-and-old-daemon-parsing"
kind: "constraint"
title: "WebSocket protocol changes must preserve old-client and old-daemon parsing"
status: "superseded"
tags: ["constraint", "compatibility", "protocol", "websocket", "validation"]
created_at: "2026-08-08T03:27:32.318Z"
updated_at: "2026-08-08T05:16:39.548Z"
---

# WebSocket protocol changes must preserve old-client and old-daemon parsing

<!-- compiled_truth -->

The WebSocket protocol is a compatibility boundary. Schema changes must remain backward-compatible in both directions, keep wire schemas structural, and place normalization outside schema declarations. The protocol package owns schema generation and validation codegen.

## Timeline

- time: "2026-08-08T03:27:32.318Z"
  kind: "created"
  summary: "Knowledge page created."
- time: "2026-08-08T05:06:24.112Z"
  kind: "evidence"
  summary: "AGENTS.md defines the backward-compatibility contract, optional-field rules, RPC naming rules, and schema purity requirements. docs/protocol-validation.md documents generated validation, protocol ownership, normalization boundaries, and regression tests. docs/architecture.md identifies packages/protocol as the source of truth for shared wire schemas."
  source: "Legacy Markdown evidence section"
- time: "2026-08-08T05:06:24.112Z"
  kind: "migration"
  summary: "Migrated from legacy page id 9ee5c5a6-f47a-4eee-aa9e-fda479e0c179 to websocket-protocol-changes-must-preserve-old-client-and-old-daemon-parsing."
- time: "2026-08-08T05:14:18.311Z"
  kind: "migration"
  summary: "Migrated to the canonical rich Markdown page format."
- time: "2026-08-08T05:16:39.548Z"
  kind: "reversal"
  summary: "Onboarding review found this claim is already canonical in repository documentation or agent instructions and is straightforward to reconstruct; the project map links that source instead of injecting a duplicate atomic page. New status: superseded."
