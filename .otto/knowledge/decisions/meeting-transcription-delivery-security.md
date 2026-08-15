---
id: "meeting-transcription-delivery-security"
kind: "decision"
title: "Meeting transcription delivery security is user-selectable"
status: "confirmed"
tags: ["meeting-transcription", "security", "privacy"]
created_at: "2026-08-14T01:03:25.523Z"
updated_at: "2026-08-14T02:06:13.009Z"
---

# Meeting transcription delivery security is user-selectable

<!-- compiled_truth -->

Meeting transcription uses a provider-neutral delivery policy selected by the user: keep transcripts on this desktop only, require an encrypted remote Otto connection before delivery, or use the current Otto connection. Secure remote delivery is the default. When remote delivery is not permitted or not currently secure, finalized text is retained locally by Otto and the transient recorder audio is discarded.

## Timeline

- time: "2026-08-14T01:03:25.523Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["zoom-recorder-titlebar-transcript-library"]
- time: "2026-08-14T01:03:25.523Z"
  kind: "evidence"
  summary: "User explicitly confirmed that people can choose the level of security appropriate to their needs (2026-08-13)."
- time: "2026-08-14T01:14:36.862Z"
  kind: "evidence"
  summary: "Implemented the confirmed delivery policy: secure remote delivery is the default; recorder finalization persists text through the daemon only on a verified encrypted active transport, otherwise in Otto Desktop's local transcript store. Local queue entries retry delivery when a compatible secure connection becomes available, and are deleted locally only after daemon persistence succeeds. Focused tests, lint, and app/desktop typechecks passed on 2026-08-13."
  source: "Implementation"
- time: "2026-08-14T02:03:42.154Z"
  kind: "evidence"
  summary: "On Windows, the packaged x64 helper executed successfully in an isolated Otto-owned data root: `--version` reported Zoom Recorder 0.1.dev and `status` reported idle/not running with the Windows audio backend (2026-08-13). This validates packaged helper startup and backend selection, not live Zoom process/audio capture."
  source: "Windows helper smoke"
- time: "2026-08-14T02:06:13.009Z"
  kind: "evidence"
  summary: "A read-only five-second probe against the running Windows Zoom processes detected both processes and their inactive capture/render streams, reporting `app_present=yes` and `in_call=no` (2026-08-13). This confirms the packaged helper can discover the installed Zoom client without creating a recording."
  source: "Windows Zoom probe"
