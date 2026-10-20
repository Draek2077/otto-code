---
id: "finding-android-dictation-exceeds-relay-message-allowance"
kind: "finding"
title: "Android dictation exceeded the relay message allowance"
status: "proposed"
tags: ["android","dictation","relay","audio","reliability"]
created_at: "2026-09-19T19:01:08.257Z"
updated_at: "2026-09-19T19:01:08.257Z"
---
# Android dictation exceeded the relay message allowance

<!-- compiled_truth -->

Android composer dictation failures over relay were associated with repeated daemon log disconnects carrying code `1013` and reason `Relay message rate exceeded`. Native capture forwarded each 1024-byte microphone read as a separate dictation message. At 16 kHz mono PCM16 this produces about 313 messages per ten seconds, exceeding the relay data-socket allowance of 200 messages per ten seconds before other traffic is counted. Web dictation already batches one second of PCM per message.

The local correction batches native dictation into one-second chunks and flushes the partial tail on stop or interruption. Cancellation discards the tail without reopening a stream. Focused regression tests and app typecheck/lint pass. A rebuilt Android app and on-device relay verification remain outstanding; no installed app, daemon, or relay was changed.

## Timeline

- time: "2026-09-19T19:01:08.257Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-09-19T19:01:08.257Z"
  kind: "evidence"
  summary: "2026-09-19: user reported consistent Otto dictation stream timeouts on Android over relay. Read-only inspection of host daemon.log found repeated relay_data_disconnected entries with code 1013 / Relay message rate exceeded at epoch milliseconds 1789843306021, 1789843316020, 1789843356726, and 1789843398980. Source: packages/expo-two-way-audio/android/src/main/java/expo/modules/twowayaudio/AudioEngine.kt uses a 1024-byte read buffer; packages/relay/src/cloudflare-adapter.ts sets MAX_DATA_MESSAGES_PER_WINDOW=200 and DATA_MESSAGE_WINDOW_MS=10000. Regression in packages/app/src/hooks/use-dictation-audio-source.native.test.ts failed before the correction with 313 emissions instead of 10 for 320010 audio bytes. After correction: 10 full 32000-byte chunks plus a 10-byte tail, byte-for-byte preserved; all four focused tests passed. npm run typecheck --workspace=@otto-code/app and targeted npm run lint passed. Troubleshooting documented in docs/android.md."
