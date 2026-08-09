---
id: "default-tab-alignment-vertical"
kind: "requirement"
title: "Fresh installs default tab alignment to Vertical"
status: "confirmed"
tags: ["workspace", "tabs", "appearance", "defaults"]
created_at: "2026-08-09T16:56:06.571Z"
updated_at: "2026-08-09T16:56:06.571Z"
---

# Fresh installs default tab alignment to Vertical

<!-- compiled_truth -->

On a fresh install, the default `defaultTabOrientation` is `vertical`, rendering desktop pane tabs as the left rail unless a saved default or per-pane orientation overrides it. Existing saved preferences remain unchanged.

## Timeline

- time: "2026-08-09T16:56:06.571Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-09T16:56:06.571Z"
  kind: "evidence"
  summary: "User request (2026-08-09); implemented in `packages/app/src/hooks/use-settings/storage.ts` and covered by `storage.test.ts`."
