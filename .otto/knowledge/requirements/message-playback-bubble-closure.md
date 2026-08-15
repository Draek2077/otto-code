---
id: "message-playback-bubble-closure"
kind: "requirement"
title: "Message playback follows bubble closure"
status: "proposed"
tags: ["chat", "voice", "playback", "auto-speech"]
created_at: "2026-08-13T23:54:32.784Z"
updated_at: "2026-08-13T23:54:32.784Z"
---

# Message playback follows bubble closure

<!-- compiled_truth -->

A chat message's manual speaker control and auto-speech eligibility are governed by the same boundary: prose becomes speakable when its bubble is closed. During a running turn, starting an action closes the preceding assistant bubble and releases it immediately; neither control waits for the whole turn or the typewriter animation to finish.

## Timeline

- time: "2026-08-13T23:54:32.784Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-13T23:54:32.784Z"
  kind: "evidence"
  summary: "User requirement, 2026-08-13. Implemented in packages/app/src/agent-stream/turn-reveal.ts, packages/app/src/components/message.tsx, and packages/app/src/voice/auto-speech-segments.ts; focused tests cover the action boundary."
