---
id: "chat-working-row-shows-spinner-elapsed-and-token-counts"
kind: "requirement"
title: "Chat working row shows spinner, elapsed time, and token counts"
status: "confirmed"
tags: ["chat","streaming","loading-state","tokens"]
created_at: "2026-08-21T22:47:22.139Z"
updated_at: "2026-08-21T23:04:43.480Z"
---
# Chat working row shows spinner, elapsed time, and token counts

<!-- compiled_truth -->

While an incoming assistant turn is processing, the conversation must keep one visible working row mounted with a spinner, an elapsed-time label, and a streamed token estimate shown after a bullet.

## Timeline

- time: "2026-08-21T22:47:22.139Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T22:47:22.139Z"
  kind: "evidence"
  summary: "User clarified the required behavior during this bug report. The implementation computes live turn token estimates in packages/app/src/timeline/turn-time.ts and renders the working row from packages/app/src/agent-stream/turn-footer.tsx; the view must pass that estimate and preserve the row while agent running state and turn-liveness snapshots hand off."
- time: "2026-08-21T23:04:43.480Z"
  kind: "evidence"
  summary: "The working row is status-only while a turn is active: it shows the spinner, elapsed time, and token count, but no fork action. Forking remains available from completed assistant-turn footers after processing ends. Targeted turn-footer test verifies the running row contains no fork control."
  source: "user requirement + implementation verification"
  affects: ["composer-controls-preserve-full-size-before-uniform-scaling"]
