---
id: "daylight-outlined-controls-match-structural-borders"
kind: "requirement"
title: "Daylight outlined controls match structural borders"
status: "confirmed"
tags: ["theme","daylight","button","border","outline","control-chrome"]
created_at: "2026-08-21T15:57:31.927Z"
updated_at: "2026-08-21T16:08:18.006Z"
---
# Daylight outlined controls match structural borders

<!-- compiled_truth -->

In the Daylight theme, outlined button chrome uses the same visible color as structural divider lines. `borderAccent`, which owns outline-button borders and split-button separators, matches `border` rather than using a paler value that blends into Daylight's warm surfaces. Components continue consuming the semantic tokens defined by the design system; this is a theme-palette correction, not a local component override.

## Timeline

- time: "2026-08-21T15:57:31.927Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["primary-sidebars-use-a-deeper-surface-than-tab-rails"]
- time: "2026-08-21T15:57:31.927Z"
  kind: "evidence"
  summary: "The user supplied a running Daylight screenshot on 2026-08-21 showing the workspace action controls' outlines nearly disappearing while adjacent horizontal divider lines remained legible, and explicitly required the outlines to match those border lines. Code inspection verified the controls use `theme.colors.borderAccent`, structural dividers use `theme.colors.border`, and Daylight currently assigns `#e3e3ea` versus `#d1d1d8` respectively. `docs/design.md` reserves `borderAccent` for outlined buttons."
- time: "2026-08-21T15:58:10.733Z"
  kind: "evidence"
  summary: "Updated Daylight's `borderAccent` from `#e3e3ea` to `#d1d1d8`, exactly matching its structural `border`. This corrects all semantic outline-button consumers and split-button separators together, including the workspace controls shown in the screenshot. App typecheck, targeted lint, formatting, `git diff --check`, and Knowledge-link lint passed."
  source: "Implementation verified on 2026-08-21"
- time: "2026-08-21T16:08:18.006Z"
  kind: "evidence"
  summary: "The follow-up screenshot did not contain the current palette. Pixel counts showed the superseded `borderAccent` `#e3e3ea` on control outlines alongside structural `#d1d1d8`, and also the superseded Daylight surfaces `#ece6dc` and `#f4f1eb`. Current source still correctly sets both `border` and `borderAccent` to `#d1d1d8`. The discrepancy is a stale development Unistyles mirror, not a remaining component or palette mismatch; a full renderer reload or explicit theme reapplication is required before visual verification."
  source: "Rendered screenshot pixel audit on 2026-08-21"
