---
id: "composer-chat-only-usage-and-dictation-controls"
kind: "requirement"
title: "Composer hides usage and dictation controls outside Chat"
status: "confirmed"
tags: ["composer","chat","terminal","dictation","usage-meter","ui"]
created_at: "2026-08-21T22:53:08.550Z"
updated_at: "2026-08-21T22:53:08.550Z"
---
# Composer hides usage and dictation controls outside Chat

<!-- compiled_truth -->

The composer shows the context-window usage ring and dictation-related controls only in Chat input mode. Terminal and any future non-chat input modes must hide the usage ring, auto-speech toggle, and voice/dictation controls while retaining the mode-appropriate text input and submit action.

## Timeline

- time: "2026-08-21T22:53:08.550Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["usage-ring-uses-semantic-status-tints","microphone-capture-lifecycle-privacy","composer-live-mode-hidden-for-drafts"]
- time: "2026-08-21T22:53:08.550Z"
  kind: "evidence"
  summary: "User requirement on 2026-08-21. Implemented through the shared mode presentation in `packages/app/src/composer/input-mode.ts` and consumed by `packages/app/src/composer/index.tsx`; `packages/app/src/composer/input-mode.test.ts` verifies Chat keeps the controls and Terminal hides them."
