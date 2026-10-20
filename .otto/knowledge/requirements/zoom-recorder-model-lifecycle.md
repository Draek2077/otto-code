---
id: "zoom-recorder-model-lifecycle"
kind: "requirement"
title: "Zoom Recorder model lifecycle"
status: "confirmed"
tags: ["zoom", "recorder", "model-download", "storage", "desktop", "settings"]
created_at: "2026-08-13T23:25:13.206Z"
updated_at: "2026-08-13T23:25:13.206Z"
---

# Zoom Recorder model lifecycle

<!-- compiled_truth -->

Zoom Recorder downloads its local transcription model when a user first enables the feature. Disabling Recorder stops capture but retains the downloaded model so re-enabling is immediate. The Meetings settings card exposes a separate explicit Delete downloaded model action, with a destructive confirmation and recovered-space estimate, so users can reclaim disk space after turning Recorder off. Model download, verification, extraction, and readiness are visible states; no fake progress indicator is used.

## Timeline

- time: "2026-08-13T23:25:13.206Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["zoom-recorder-titlebar-transcript-library","zoom-recorder-is-desktop-host-local-only","zoom-recorder-host-local-speech-runtime"]
- time: "2026-08-13T23:25:13.206Z"
  kind: "evidence"
  summary: "Explicit user decision."
