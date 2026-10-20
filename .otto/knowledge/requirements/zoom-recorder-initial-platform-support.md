---
id: "zoom-recorder-initial-platform-support"
kind: "requirement"
title: "Zoom Recorder initially supports Windows x64 and Linux x64"
status: "confirmed"
tags: ["zoom","recorder","desktop","platform"]
created_at: "2026-08-13T23:42:40.919Z"
updated_at: "2026-10-05T14:10:22.967Z"
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
- time: "2026-09-04T17:17:49.398Z"
  kind: "evidence"
  summary: "Installed Otto 0.9.0 x64 on Windows x64 reported Recorder unavailable because `resources/zoom-recorder/otto-zoom-recorder.exe` was absent. The checkout and the prior 0.8.19 x64 unpacked package both contained the 50 MB helper. The 0.9.0 x64 installer is therefore missing its required runtime payload, not running on an unsupported platform. Desktop packaging now verifies the post-pack x64 Windows/Linux helper path and fails the build when it is absent."
  source: "Local installed-release audit, 2026-09-04"
- time: "2026-10-05T13:36:04.856Z"
  kind: "evidence"
  summary: "Windows Zoom Workplace 7.1.9.48550 exposed active render and capture sessions on nondefault devices while retaining inactive sessions for the same Zoom PID on the default devices. The previous frozen helper inspected only the default multimedia endpoints and reported call=no. A locally rebuilt helper scanning all active endpoints reported call=YES against the same live session. Detection now preserves ACTIVE when a PID has both active and inactive device sessions, and scans remaining devices after a device-inspection failure. Seven focused, hardware-independent Python regressions pass; desktop typecheck and repository lint pass. This is Windows detection proof only: the title-bar indicator and recording/transcription were not exercised. Windows microphone recording still uses the default input. The reported Linux failure remains unverified and its separate PipeWire detector was not changed."
  source: "Windows 11 live WASAPI audit and native frozen-helper probe, 2026-10-05; wasapi.py, tests/test_wasapi.py, docs/development.md"
- time: "2026-10-05T14:10:22.967Z"
  kind: "evidence"
  summary: "The follow-up now connects detection to actual capture on both platforms. Windows microphone targets carry Zoom's active IMMDevice endpoint ID and are matched to PortAudio WASAPI devices by that ID, including identically named devices and hotplug, rather than the default input. A short live Windows capture selected the Realtek microphone array while Windows defaulted to the Razer Kiyo microphone. It produced 32,160 microphone frames at 16 kHz and 95,520 playback frames at 48 kHz; microphone samples were nonzero and playback was silent at that moment. Native ApplicationLoopback WAV_EXTENSIBLE float audio was rejected by the prior Python/onnx-asr file reader. The helper now packages soundfile/libsndfile, decodes PCM and float WAVs to mono float32, and supplies the native rate to ASR's resampler. Linux detection now uses Zoom application/process identity on nodes or their owning client plus audio media.class, and resolves devices through Zoom's actual links. Integer/string IDs are normalized for discovery, capture-port lookup, and tap health. Changes to playback ports roll a part; a tap's device fallback retains the requested port identity so it is not restarted on every poll. Automatic recording no longer substitutes unrelated default devices for missing Zoom routes. Windows loopback failures are reported without whole-device capture; Linux retains its explicit, logged fallback to the linked speaker monitor. Status reports missing tracks and ERROR if both captures fail. Forty focused tests pass, along with desktop typecheck and repository lint; the Windows helper rebuild and smoke tests pass. Linux graph/device-switch cases are tested without a laptop, but live Linux capture and actual speech recognition remain unverified."
  source: "2026-10-05 Zoom recorder audio routing follow-up; wasapi.py, pipewire.py, capture_windows.py, capture_linux.py, recorder.py, daemon.py, batch.py; four focused P"
