---
id: "brain-calibration-survives-a-context-size-edit"
kind: "requirement"
title: "Brain calibration survives a context-size edit"
status: "proposed"
tags: ["brain", "calibration", "vram"]
created_at: "2026-08-15T14:23:44.977Z"
updated_at: "2026-08-16T19:45:05.009Z"
---

# Brain calibration survives a context-size edit

<!-- compiled_truth -->

The Brain `calibrationRequired` flag may only be set by settings that change the KV cache system (cache types, flash attention, vision / enabled components) or the evaluation (the context multiplier / extended RoPE shape). `contextSize` never sets it: it is the independent variable the calibration sweeps to get its per-token slope, and `calibrationKey` deliberately does not record it. `gpuLayers` and `parallelSlots` also never set it: the calibration is a differential measurement (GPU delta between two context sizes), so every fixed term — weights wherever they sit, CUDA context, compute buffers — cancels out of the slope, and a load whose KV split to CPU is rejected as unusable rather than measured low. Neither changes the bytes/token or the evaluation. `CALIBRATION_INPUTS` in `packages/brain/src/config/profile-edit.ts` is exactly: `contextMultiplier`, `cacheTypeK`, `cacheTypeV`, `flashAttention`, `vision`, `enabledComponents`.

## Timeline

- time: "2026-08-15T14:23:44.977Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-host-control","brain-model-bundles"]
- time: "2026-08-15T14:23:44.977Z"
  kind: "evidence"
  summary: "Reported 2026-08-15: calibrating a model showed \"Measured\" and then reverted to \"Estimated\", and \"Fit to VRAM\" wrote a context far past the VRAM limit.\n\nCause: `contextSize` was added to `CALIBRATION_INPUTS` in 63c338c1e (\"fix(brain): validate model profile writes\"). The profile editor autosaves the whole draft on every edit, so any context change - including the write \"Fit to VRAM\" makes itself - set `calibrationRequired = true`. Every read path (`host-api.ts` inventory, profile set, and budget preview) gates on that flag, so the budget fell back to the theoretical formula, which overestimates by ~3-7x on these architectures. The fit had been sized against the measured figure, so the saved context no longer fit.\n\nSecond cause of the same symptom: `ModelDetail` did not make the profile editor re-read the profile when a calibrate job succeeded, so its budget panel kept reporting the estimate it loaded with even though the brain had persisted the measurement.\n\nFixes: dropped `contextSize` from `CALIBRATION_INPUTS`; `maxContextThatFits` now derives its per-token cost from `probe.kvBytes + probe.drafterKvBytes`; the editor takes a `reloadToken` bumped on calibration completion. Regression tests added in `vram.test.ts` and `profile-edit.test.ts`."
- time: "2026-08-16T19:45:05.009Z"
  kind: "decision"
  summary: "User confirmed 2026-08 (this session): when Brain Model settings change, only values affecting the KV cache systems and the evaluation need to be considered in the calibration-required flag. Removed `gpuLayers` and `parallelSlots` from `CALIBRATION_INPUTS` in packages/brain/src/config/profile-edit.ts; added a regression test that a gpuLayers/parallelSlots-only edit keeps a stored calibration."
