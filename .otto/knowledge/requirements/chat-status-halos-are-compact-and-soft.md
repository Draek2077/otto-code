---
id: "chat-status-halos-are-compact-and-soft"
kind: "requirement"
title: "Chat attention status halos are compact and soft"
status: "proposed"
tags: ["chat","status","visual-design","accessibility"]
created_at: "2026-08-21T01:03:10.306Z"
updated_at: "2026-08-21T02:12:18.941Z"
---
# Chat attention status halos are compact and soft

<!-- compiled_truth -->

The shared halo behind chat attention status icons for notifications, questions, and errors must remain compact relative to the glyph and use a gentle center-to-edge color falloff. It should communicate attention without becoming a dominant colored disc.

## Timeline

- time: "2026-08-21T01:03:10.306Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T01:03:10.306Z"
  kind: "evidence"
  summary: "User feedback on 2026-08-20 requested a smaller circumference and a softer center for the shared status-bucket halo. Implemented in `packages/app/src/components/status-pulse-glow.tsx`."
- time: "2026-08-21T01:03:52.430Z"
  kind: "evidence"
  summary: "After the first reduction, the user said the halo looked better overall but was not powerful enough. The compact extent remains; the gradient's center, middle, and outer opacity stops were raised while preserving the softened falloff."
  source: "User feedback, 2026-08-20"
- time: "2026-08-21T01:04:34.181Z"
  kind: "evidence"
  summary: "The user requested a further small lift at both the resting and peak ends of the attention halo. Resting animation opacity and all nonzero gradient stops were increased without changing the compact halo extent."
  source: "User feedback, 2026-08-20"
- time: "2026-08-21T01:04:56.873Z"
  kind: "evidence"
  summary: "The user finalized the compact halo circumference at 1.5× the glyph size."
  source: "User feedback, 2026-08-20"
- time: "2026-08-21T01:05:32.747Z"
  kind: "evidence"
  summary: "The user reverted the 1.5× circumference preference and selected 1.75× as the preferred halo extent."
  source: "User feedback, 2026-08-20"
- time: "2026-08-21T02:12:18.941Z"
  kind: "evidence"
  summary: "Updated `packages/app/src/components/status-pulse-glow.tsx` so the non-animated settings path holds the halo at `progress = 1`, the pulse peak, instead of `progress = 0`, the dim/resting frame. This keeps the static status halo visible while preserving the animated range."
  source: "User feedback and implementation, 2026-08-20"
