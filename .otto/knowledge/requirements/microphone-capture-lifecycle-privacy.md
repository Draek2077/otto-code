---
id: "microphone-capture-lifecycle-privacy"
kind: "requirement"
title: "Microphone capture follows active listening"
status: "confirmed"
tags: ["privacy", "microphone", "wake-word", "voice"]
created_at: "2026-08-09T15:04:25.876Z"
updated_at: "2026-08-09T15:04:25.876Z"
---

# Microphone capture follows active listening

<!-- compiled_truth -->

Otto must not hold a microphone-capable audio session merely because the application or an audio engine has started. The operating-system microphone indicator may appear only while Hey Otto detection or dictation is actively capturing audio; disabling or pausing Hey Otto and ending dictation must release microphone capture.

## Timeline

- time: "2026-08-09T15:04:25.876Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-09T15:04:25.876Z"
  kind: "evidence"
  summary: "User requirement, 2026-08-09. Implemented in packages/expo-two-way-audio/ios/AudioEngine.swift and documented in docs/wake-word.md."
