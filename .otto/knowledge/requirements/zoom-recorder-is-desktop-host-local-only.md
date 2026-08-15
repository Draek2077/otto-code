---
id: "zoom-recorder-is-desktop-host-local-only"
kind: "requirement"
title: "Zoom Recorder is desktop host-local only"
status: "confirmed"
tags: ["zoom", "recorder", "desktop", "windows", "linux", "macos", "mobile-out-of-scope"]
created_at: "2026-08-13T23:09:37.689Z"
updated_at: "2026-08-13T23:09:52.945Z"
---

# Zoom Recorder is desktop host-local only

<!-- compiled_truth -->

Zoom Recorder is supported in Otto Desktop on Windows and Linux. Its existing recorder capture/transcription stack is embedded in the Desktop frontend and runs on the same physical machine as the Zoom client. macOS support is deferred pending separate technical validation and is not committed scope. Otto mobile does not expose Zoom Recorder and does not attempt to capture or transcribe Zoom Android/iOS audio. The Desktop stack sends finalized transcript data, not retained audio, to the Daemon for storage and AI use.

## Timeline

- time: "2026-08-13T23:09:37.689Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["zoom-recorder-titlebar-transcript-library","zoom-recorder-host-local-speech-runtime"]
- time: "2026-08-13T23:09:37.689Z"
  kind: "evidence"
  summary: "Explicit user decision."
- time: "2026-08-13T23:09:52.945Z"
  kind: "decision"
  summary: "User corrected the initial platform scope: macOS is not confirmed."
  source: "Explicit user decision"
  affects: ["zoom-recorder-titlebar-transcript-library","zoom-recorder-host-local-speech-runtime"]
