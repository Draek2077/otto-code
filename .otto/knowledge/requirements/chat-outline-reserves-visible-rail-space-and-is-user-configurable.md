---
id: "chat-outline-reserves-visible-rail-space-and-is-user-configurable"
kind: "requirement"
title: "Chat outline reserves visible rail space and is user-configurable"
status: "proposed"
tags: ["chat","chat-outline","layout","settings","accessibility"]
created_at: "2026-08-29T13:55:44.375Z"
updated_at: "2026-08-29T14:05:44.048Z"
---
# Chat outline reserves visible rail space and is user-configurable

<!-- compiled_truth -->

The Chat outline is enabled by default and can be disabled from Chat presentation settings. When its rail is visibly rendered in a wide web chat, every chat-width-bounded surface reserves a 24px left inset. Together with the chat’s existing inner gutter, this clears the rail while keeping the transcript, composer, and supporting chat tracks only slightly right of their ordinary positions and within their existing right boundary. When the rail is disabled, unsupported, not yet useful, narrow, or native, the existing layout remains unchanged. The reservation applies independently of the Default, Wide, and Full chat-width choices.

## Timeline

- time: "2026-08-29T13:55:44.375Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-29T13:55:44.375Z"
  kind: "evidence"
  summary: "User-reported overlap with the new chapter browser, 2026-08-29. Implemented in `packages/app/src/agent-stream/chat-outline/layout.tsx`, `packages/app/src/components/chat-width-bounds.tsx`, `packages/app/src/agent-stream/view.tsx`, and Chat Appearance settings; verified with `npx vitest run packages/app/src/hooks/use-settings/storage.test.ts --bail=1` (231 passed), targeted `npm run lint`, and `npm run typecheck --workspace=@otto-code/app`."
- time: "2026-08-29T14:05:44.048Z"
  kind: "decision"
  summary: "User feedback on 2026-08-29 found the first inset excessive; the existing inner chat gutter supplies the remainder of the clearance."
  source: "User feedback and verified implementation, 2026-08-29"
