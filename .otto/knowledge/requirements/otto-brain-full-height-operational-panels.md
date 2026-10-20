---
id: "otto-brain-full-height-operational-panels"
kind: "requirement"
title: "Otto Brain operational panels use available viewport height"
status: "confirmed"
tags: ["brain", "ui", "models", "logs", "layout"]
created_at: "2026-08-11T03:35:05.548Z"
updated_at: "2026-08-11T03:38:15.251Z"
---

# Otto Brain operational panels use available viewport height

<!-- compiled_truth -->

In Otto Brain, the Models list must use all available page height and scroll within the table only after it reaches that height, while the disk-usage summary remains visible at the bottom. The Models split divider must run edge-to-edge within the two pane boundary. The fixed Score column must be wide enough for its header in compact and regular layouts. In compact/mobile layouts, the Caps column must reserve enough width for its doubled capability icons without overlapping the adjacent column. The Logs panel must offer a copy-to-clipboard action at its top right.

## Timeline

- time: "2026-08-11T03:35:05.548Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-11T03:35:05.548Z"
  kind: "evidence"
  summary: "User request in chat on 2026-08-10; implemented in packages/app/src/screens/brain/brain-screen.tsx, models-tab.tsx, and logs-tab.tsx."
- time: "2026-08-11T03:37:26.346Z"
  kind: "decision"
  summary: "User added the compact/mobile capability-column width requirement in chat on 2026-08-10."
  source: "User request in chat on 2026-08-10."
- time: "2026-08-11T03:38:15.251Z"
  kind: "decision"
  summary: "User added the Score-column readability requirement in chat on 2026-08-10."
  source: "User request in chat on 2026-08-10."
