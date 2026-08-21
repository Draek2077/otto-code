---
id: "finding-theme-palette-hot-reload-retains-stale-unistyles-mirror"
kind: "finding"
title: "Theme palette hot reload can retain a stale Unistyles mirror"
status: "proposed"
tags: ["finding","theme","unistyles","hot-reload","development"]
created_at: "2026-08-21T16:06:35.639Z"
updated_at: "2026-08-21T16:06:35.639Z"
---
# Theme palette hot reload can retain a stale Unistyles mirror

<!-- compiled_truth -->

In the development desktop, editing authored theme palette constants can hot-reload source modules without repainting the already-registered Unistyles `light`/`dark` mirror. The running UI can therefore continue rendering the previous palette until a full application reload or an explicit `applyColorScheme` execution. Verified screenshots rendered old Daylight surface and border-accent values after newer values were present in source. It remains to decide whether development Fast Refresh should explicitly trigger a palette mirror repaint.

## Timeline

- time: "2026-08-21T16:06:35.639Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["primary-sidebars-use-a-deeper-surface-than-tab-rails","daylight-outlined-controls-match-structural-borders"]
- time: "2026-08-21T16:06:35.639Z"
  kind: "evidence"
  summary: "On 2026-08-21, pixel-frequency analysis of the user's running screenshots found `#ece6dc` and `#f4f1eb`, the superseded Daylight sidebar values, plus `#e3e3ea`, the superseded Daylight `borderAccent`, while current source defined `#e9e7df`, `#f2f1ec`, and `#d1d1d8`. `packages/app/src/screens/settings/appearance/apply-color-scheme.ts` copies variant palette values into registered `light` and `dark` mirror keys, and `ProvidersWrapper` only reruns that copy when settings or OS color-scheme dependencies change."
