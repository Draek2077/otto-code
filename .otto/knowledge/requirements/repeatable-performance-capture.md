---
id: "repeatable-performance-capture"
kind: "requirement"
title: "Repeatable performance captures preserve concurrent-chat evidence"
status: "proposed"
tags: ["performance", "diagnostics", "desktop", "proposal"]
created_at: "2026-08-09T14:18:26.888Z"
updated_at: "2026-08-09T14:18:26.888Z"
---

# Repeatable performance captures preserve concurrent-chat evidence

<!-- compiled_truth -->

Proposed: Otto should let users explicitly start and stop repeated performance captures during hard-to-reproduce UI stutters. Each completed capture must be stored separately without overwriting prior sessions and correlate client frame/resource/daemon-traffic observations with daemon diagnostics so investigations can distinguish UI from daemon overload.

## Timeline

- time: "2026-08-09T14:18:26.888Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-09T14:18:26.888Z"
  kind: "evidence"
  summary: "User request on 2026-08-09: needs repeatable captures while reproducing multi-chat UI stutters and slow terminal typing."
