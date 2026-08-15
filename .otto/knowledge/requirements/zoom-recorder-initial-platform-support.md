---
id: "zoom-recorder-initial-platform-support"
kind: "requirement"
title: "Zoom Recorder initially supports Windows x64 and Linux x64"
status: "confirmed"
tags: ["zoom", "recorder", "desktop", "platform"]
created_at: "2026-08-13T23:42:40.919Z"
updated_at: "2026-08-14T16:07:48.144Z"
---

# Zoom Recorder initially supports Windows x64 and Linux x64

<!-- compiled_truth -->

The first Otto Zoom Recorder release supports only Windows x64 and Linux x64. The recorder helper is a native frozen Python/ONNX runtime and must be built for its target architecture. Windows ARM64 remains unavailable until Otto has an ARM-native helper build runner; Otto must hide the feature rather than ship an incompatible helper.

## Timeline

- time: "2026-08-13T23:42:40.919Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-13T23:42:40.919Z"
  kind: "evidence"
  summary: "User explicitly confirmed the initial Windows x64 and Linux x64 scope after reviewing the native helper architecture constraint."
- time: "2026-08-14T00:47:13.918Z"
  kind: "evidence"
  summary: "The PyInstaller helper was built natively with Python 3.12 and the pinned `requirements-build.txt` stack. The produced `otto-zoom-recorder.exe` was 50,130,945 bytes and passed both `--version` and `status`, reporting the Windows audio backend. `build-zoom-recorder-runtime.py` now runs the same isolated smoke test after every supported native freeze, so Linux and Windows release builds both gate packaging on a bootable helper. Linux still requires execution on its native release runner; PyInstaller does not cross-compile the ONNX runtime."
  source: "Local Windows x64 native build validation (2026-08-13)"
- time: "2026-08-14T06:32:37.484Z"
  kind: "evidence"
  summary: "Live Windows 11 validation exposed and corrected three frozen-helper faults before real capture could complete: setup completion wrote `status.SETUP_STAMP` instead of `paths.SETUP_STAMP`; process detection used a substring match that treated `otto-zoom-recorder.exe` as Zoom and prevented end-of-call detection; and the Unix-only `os.nice()` priority adjustment stalled the Windows transcription worker. After rebuilding, an idle probe recognized only Zoom.exe/CptHost.exe, and a 26.7-second test call transcribed its 839,532-byte microphone WAV in 4.0 seconds of model load plus 0.4 seconds of recognition (67x realtime). The helper then removed the 840 KB temporary audio and retained transcript.md."
  source: "Local Windows x64 Otto Dev live validation (2026-08-14)"
- time: "2026-08-14T15:59:49.809Z"
  kind: "evidence"
  summary: "A Windows validation run found multiple orphaned `otto-zoom-recorder` helper processes active against the same recorder data root, which can create parallel near-duplicate captures/transcripts for one Zoom meeting. The packaged watcher now takes an OS-level exclusive lock on `watch.lock` under the recorder data root and exits cleanly when another watcher owns it."
  source: "Windows duplicate-capture investigation"
- time: "2026-08-14T16:07:48.144Z"
  kind: "evidence"
  summary: "Recorder ownership control now distinguishes watcher-lock conflicts (exit code 73), reports the owning helper PID through desktop status, and exposes an explicit Take control operation that terminates the recorded owner before starting the current watcher. The UI presents Take control in the Meeting Notes popup when another Otto instance owns the recorder."
  source: "recorder ownership control implementation"
