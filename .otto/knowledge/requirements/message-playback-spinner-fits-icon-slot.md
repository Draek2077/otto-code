---
id: "message-playback-spinner-fits-icon-slot"
kind: "requirement"
title: "Message playback loading spinner fits its icon slot"
status: "proposed"
tags: ["chat","audio","playback","loading","ui","layout"]
created_at: "2026-08-21T22:28:25.701Z"
updated_at: "2026-09-04T18:03:39.773Z"
---
# Message playback loading spinner fits its icon slot

<!-- compiled_truth -->

The chat message audio playback button must keep its loading spinner within the same icon slot as the idle speaker and active stop glyphs. Chat summary-row action glyphs use the tool-call action token, `chromeXs` (12px desktop, 18px compact), while their press targets retain their existing geometry. The playback spinner receives that token directly rather than a platform preset plus transform, so its intrinsic layout box does not overflow or change the footer geometry.

## Timeline

- time: "2026-08-21T22:28:25.701Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T22:28:25.701Z"
  kind: "evidence"
  summary: "User-reported screenshot and requirement on 2026-08-21. Implemented in `packages/app/src/components/message-playback-button.tsx` by rendering `LoadingSpinner` with `size={PLAYBACK_ICON_SIZE}` and removing the transform-based shrink. Targeted lint, formatting, app typecheck, and `git diff --check` passed. Repository-wide typecheck was attempted but remains blocked by the pre-existing missing `remark-directive` dependency in `packages/website/src/docs-rehype.ts`."
- time: "2026-09-04T18:03:39.773Z"
  kind: "decision"
  summary: "The user explicitly standardized chat summary-row action glyphs on the compact tool-call action size. Status returned to proposed for review."
  source: "user requirement, 2026-09-04"
