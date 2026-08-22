---
id: "message-playback-spinner-fits-icon-slot"
kind: "requirement"
title: "Message playback loading spinner fits its icon slot"
status: "confirmed"
tags: ["chat","audio","playback","loading","ui","layout"]
created_at: "2026-08-21T22:28:25.701Z"
updated_at: "2026-08-21T22:28:25.701Z"
---
# Message playback loading spinner fits its icon slot

<!-- compiled_truth -->

The chat message audio playback button must keep its loading spinner within the same 16px icon slot as the idle speaker and active stop glyphs. It uses the numeric slot size rather than a platform preset plus transform, so the spinner's intrinsic layout box does not overflow or change the chat bubble footer geometry.

## Timeline

- time: "2026-08-21T22:28:25.701Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T22:28:25.701Z"
  kind: "evidence"
  summary: "User-reported screenshot and requirement on 2026-08-21. Implemented in `packages/app/src/components/message-playback-button.tsx` by rendering `LoadingSpinner` with `size={PLAYBACK_ICON_SIZE}` and removing the transform-based shrink. Targeted lint, formatting, app typecheck, and `git diff --check` passed. Repository-wide typecheck was attempted but remains blocked by the pre-existing missing `remark-directive` dependency in `packages/website/src/docs-rehype.ts`."
