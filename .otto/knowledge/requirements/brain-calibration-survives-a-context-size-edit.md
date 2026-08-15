---
id: "brain-calibration-survives-a-context-size-edit"
kind: "requirement"
title: "Brain calibration survives a context-size edit"
status: "proposed"
tags: ["brain", "calibration", "vram"]
created_at: "2026-08-15T14:23:44.977Z"
updated_at: "2026-08-15T14:23:44.977Z"
---

# Brain calibration survives a context-size edit

<!-- compiled_truth -->

A saved Brain calibration measures KV bytes **per token**, so changing a profile's `contextSize` must never mark that profile as needing recalibration. Context size is the independent variable the calibration sweeps to get its slope, and `calibrationKey` deliberately does not record it, so a measurement is valid at every context. `CALIBRATION_INPUTS` in `packages/brain/src/config/profile-edit.ts` therefore lists only the settings that genuinely change the measurement (cache types, context multiplier, flash attention, GPU layers, parallel slots, vision, enabled components).

Related: `maxContextThatFits` must charge the same per-token cost `budget()` charges, including a speculative drafter's own KV pool, or the context it returns is one the budget then rejects.

## Timeline

- time: "2026-08-15T14:23:44.977Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-host-control","brain-model-bundles"]
- time: "2026-08-15T14:23:44.977Z"
  kind: "evidence"
  summary: "Reported 2026-08-15: calibrating a model showed \"Measured\" and then reverted to \"Estimated\", and \"Fit to VRAM\" wrote a context far past the VRAM limit.\n\nCause: `contextSize` was added to `CALIBRATION_INPUTS` in 63c338c1e (\"fix(brain): validate model profile writes\"). The profile editor autosaves the whole draft on every edit, so any context change - including the write \"Fit to VRAM\" makes itself - set `calibrationRequired = true`. Every read path (`host-api.ts` inventory, profile set, and budget preview) gates on that flag, so the budget fell back to the theoretical formula, which overestimates by ~3-7x on these architectures. The fit had been sized against the measured figure, so the saved context no longer fit.\n\nSecond cause of the same symptom: `ModelDetail` did not make the profile editor re-read the profile when a calibrate job succeeded, so its budget panel kept reporting the estimate it loaded with even though the brain had persisted the measurement.\n\nFixes: dropped `contextSize` from `CALIBRATION_INPUTS`; `maxContextThatFits` now derives its per-token cost from `probe.kvBytes + probe.drafterKvBytes`; the editor takes a `reloadToken` bumped on calibration completion. Regression tests added in `vram.test.ts` and `profile-edit.test.ts`."
