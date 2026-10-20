---
id: "otto-uses-a-local-first-daemon-with-multiple-clients"
kind: "architecture"
title: "Otto uses a local-first daemon with multiple clients"
status: "superseded"
tags: ["architecture", "daemon", "clients", "local-first", "relay"]
created_at: "2026-08-08T03:27:26.087Z"
updated_at: "2026-08-08T05:16:39.151Z"
---

# Otto uses a local-first daemon with multiple clients

<!-- compiled_truth -->

Otto is a client-server system centered on a local Node.js daemon that manages agent processes and exposes a WebSocket API. Mobile, web, desktop, and CLI clients connect to the daemon, while an optional encrypted relay supports remote access.

## Timeline

- time: "2026-08-08T03:27:26.087Z"
  kind: "created"
  summary: "Knowledge page created."
- time: "2026-08-08T05:06:24.112Z"
  kind: "evidence"
  summary: "README.md describes self-hosted, cross-device operation and the daemon/client model. docs/architecture.md documents the daemon, WebSocket clients, desktop-managed subprocess, and optional encrypted relay."
  source: "Legacy Markdown evidence section"
- time: "2026-08-08T05:06:24.112Z"
  kind: "migration"
  summary: "Migrated from legacy page id 5a6d0fdd-748b-4e65-99a9-48c7987aa56d to otto-uses-a-local-first-daemon-with-multiple-clients."
- time: "2026-08-08T05:14:18.311Z"
  kind: "migration"
  summary: "Migrated to the canonical rich Markdown page format."
- time: "2026-08-08T05:16:39.151Z"
  kind: "reversal"
  summary: "Onboarding review found this claim is already canonical in repository documentation or agent instructions and is straightforward to reconstruct; the project map links that source instead of injecting a duplicate atomic page. New status: superseded."
