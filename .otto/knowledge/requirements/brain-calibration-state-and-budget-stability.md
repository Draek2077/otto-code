---
id: "brain-calibration-state-and-budget-stability"
kind: "requirement"
title: "Brain keeps the last calibration until recalibration"
status: "confirmed"
tags: ["brain","calibration","vram","model-settings","ui"]
created_at: "2026-08-21T18:45:38.990Z"
updated_at: "2026-08-21T18:45:38.990Z"
---
# Brain keeps the last calibration until recalibration

<!-- compiled_truth -->

Brain marks a profile as needing recalibration only when a calibration input changes. The VRAM budget and related cached-chat sizing keep using the model's most recent direct calibration while that verdict is stale, instead of reverting to the theoretical estimate. The UI and TUI expose the stale/recalibrate state so the value is visibly provisional. A model with no prior direct calibration uses the theoretical estimate until its first successful calibration. An exact current calibration is not marked stale merely because older keyed calibrations remain in history.

## Timeline

- time: "2026-08-21T18:45:38.990Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T18:45:38.990Z"
  kind: "evidence"
  summary: "User direction, 2026-08-21: retain the last value until a new calibration exists, avoid estimated/calculated flip-flopping, and distinguish settings that require recalibration from settings that only change the displayed budget.\n\nImplemented in packages/brain/src/config/profiles.ts (`getLastCalibration`, `getCalibrationForBudget`, exact-key stale detection), profile-edit.ts, host-api.ts, serve.ts, supervisor.ts, CLI/TUI budget paths, and packages/app/src/screens/brain/models-tab.tsx. docs/brain.md now documents the stable stale-budget behavior. Focused Brain tests (92), Brain typecheck, app typecheck, targeted lint, formatting, and diff checks passed."
