---
id: "zoom-recorder-host-local-speech-runtime"
kind: "finding"
title: "Zoom Recorder requires a host-local speech runtime"
status: "confirmed"
tags: ["zoom", "recorder", "speech", "transcription", "security", "desktop", "daemon"]
created_at: "2026-08-13T23:08:06.800Z"
updated_at: "2026-08-13T23:08:06.800Z"
---

# Zoom Recorder requires a host-local speech runtime

<!-- compiled_truth -->

Otto currently has reusable local-speech infrastructure: a Sherpa-ONNX worker, model catalog, integrity-checked background downloader, and readiness states. Its supported offline STT catalog is Parakeet TDT 0.6B int8 v2 (English) and v3 (25 European languages). The present runtime is daemon-hosted. Because Zoom Recorder captures on Otto Desktop's physical host while the Daemon may be remote/virtual, Recorder cannot use that daemon runtime unchanged without sending audio across the boundary. It needs the same engine/model infrastructure extracted or hosted as a Desktop-local runtime; only transcript text then crosses to the Daemon.

## Timeline

- time: "2026-08-13T23:08:06.800Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["zoom-recorder-titlebar-transcript-library","phi-vm-boundaries-require-encrypted-otto-transport"]
- time: "2026-08-13T23:08:06.800Z"
  kind: "evidence"
  summary: "Code inspection: packages/server/src/server/speech/providers/local/sherpa/model-catalog.ts and model-downloader.ts; packages/server/src/server/speech/speech-runtime.ts. User-confirmed topology and PHI constraints."
