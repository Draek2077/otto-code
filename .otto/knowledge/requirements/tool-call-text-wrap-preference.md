---
id: "tool-call-text-wrap-preference"
kind: "requirement"
title: "Tool-call text can wrap without truncation"
status: "proposed"
tags: ["tool-calls","appearance","chat","provider-neutral"]
created_at: "2026-08-21T02:32:30.023Z"
updated_at: "2026-08-21T02:32:30.023Z"
---
# Tool-call text can wrap without truncation

<!-- compiled_truth -->

Otto provides a device-local Appearance preference that lets users display complete tool-call names and summaries on wrapped lines instead of one-line truncation. This presentation preference remains independent of the existing Detailed versus Overview tool-call detail level and applies through the provider-neutral shared chat rendering path on web and native.

## Timeline

- time: "2026-08-21T02:32:30.023Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T02:32:30.023Z"
  kind: "evidence"
  summary: "User request on 2026-08-20; implementation in `packages/app/src/hooks/use-settings/`, `packages/app/src/components/message.tsx`, and `packages/app/src/screens/settings/appearance/appearance-section.tsx`."
