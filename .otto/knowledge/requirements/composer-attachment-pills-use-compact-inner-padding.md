---
id: "composer-attachment-pills-use-compact-inner-padding"
kind: "requirement"
title: "Composer attachment pills use compact inner padding"
status: "confirmed"
tags: ["composer","attachments","pills","layout","interaction-design"]
created_at: "2026-08-21T22:03:55.849Z"
updated_at: "2026-08-21T22:08:53.478Z"
---
# Composer attachment pills use compact inner padding

<!-- compiled_truth -->

Composer attachment pills use compact inner padding around their icon and text content: 4px on the left and vertically, with a 6px right inset for the labelled attachment body. The shared labelled attachment pill body uses a 40px shared content height, so labelled and image attachment bodies keep consistent compact geometry.

## Timeline

- time: "2026-08-21T22:03:55.849Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["composer-dismissal-is-permanent-discard"]
- time: "2026-08-21T22:03:55.849Z"
  kind: "evidence"
  summary: "Explicit user UI requirement from the composer screenshot on 2026-08-21. Implemented in `packages/app/src/components/attachment-pill.tsx` by changing `labelBody.paddingHorizontal` from `theme.spacing[3]` (12px) to `theme.spacing[1]` (4px). Targeted lint, app typecheck, focused composer attachment tests (9/9), formatting, and `git diff --check` passed."
- time: "2026-08-21T22:06:35.209Z"
  kind: "decision"
  summary: "User correction on 2026-08-21 clarified that the 4px maximum applies to top and bottom as well as left and right. Updated `packages/app/src/components/attachment-pill.tsx` with 4px vertical padding and reduced the shared content height from 48px to 40px so the fixed height no longer creates excess vertical space."
  source: "User-provided composer screenshot and correction, 2026-08-21"
  affects: ["composer-dismissal-is-permanent-discard"]
- time: "2026-08-21T22:07:22.303Z"
  kind: "decision"
  summary: "User refinement on 2026-08-21 requested one additional pixel on the right side for the composer attachment pill. Updated `packages/app/src/components/attachment-pill.tsx` to use a 4px left inset and 5px right inset while keeping vertical padding at 4px."
  source: "User-provided composer screenshot and spacing correction, 2026-08-21"
  affects: ["composer-dismissal-is-permanent-discard"]
- time: "2026-08-21T22:08:53.478Z"
  kind: "decision"
  summary: "User refinement on 2026-08-21 requested one additional pixel on the right side. Updated `packages/app/src/components/attachment-pill.tsx` from a 5px to a 6px right inset while keeping the left and vertical spacing unchanged."
  source: "User-provided composer screenshot and spacing correction, 2026-08-21"
  affects: ["composer-dismissal-is-permanent-discard"]
