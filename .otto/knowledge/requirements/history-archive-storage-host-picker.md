---
id: "history-archive-storage-host-picker"
kind: "requirement"
title: "Archive storage is reported in the host picker"
status: "confirmed"
tags: ["history", "archive", "storage", "ui"]
created_at: "2026-08-09T15:22:13.393Z"
updated_at: "2026-08-09T15:22:13.393Z"
---

# Archive storage is reported in the host picker

<!-- compiled_truth -->

When History can obtain archive storage statistics, it must show the total beside “All hosts” and each host’s archive size beside that host inside the host picker. It must not render a separate archive-storage report below the History filters.

## Timeline

- time: "2026-08-09T15:22:13.393Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-09T15:22:13.393Z"
  kind: "evidence"
  summary: "User requirement, 2026-08-09. Implemented in packages/app/src/screens/sessions-screen.tsx and the shared host picker."
