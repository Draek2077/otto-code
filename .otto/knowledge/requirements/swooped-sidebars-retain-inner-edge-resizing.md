---
id: "swooped-sidebars-retain-inner-edge-resizing"
kind: "requirement"
title: "Swooped sidebars retain inner-edge resizing"
status: "confirmed"
tags: ["sidebar","workspace","layout","desktop","interaction-design"]
created_at: "2026-09-19T22:20:14.699Z"
updated_at: "2026-09-19T22:20:14.699Z"
---
# Swooped sidebars retain inner-edge resizing

<!-- compiled_truth -->

When a collapsed sidebar is temporarily revealed from a screen edge on maximized or fullscreen Electron desktop, it keeps the same visible, draggable inner-edge splitter as its docked presentation. The right-side Explorer splitter sits on the overlay's left edge, resizes the panel live while it remains anchored to the right screen edge, and commits to the same per-workspace Explorer width preference used by the docked sidebar. The left app sidebar retains the mirrored behavior on its right edge.

## Timeline

- time: "2026-09-19T22:20:14.699Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-09-19T22:20:14.699Z"
  kind: "evidence"
  summary: "Requested explicitly by the user on 2026-09-19 after observing that the left swooped sidebar was fully resizable but the right swooped Explorer had no visible handle. Implemented in `packages/app/src/components/split-container.tsx` by mounting the existing resize handle inside the right edge-peek surface and reusing the docked Explorer preview/commit callbacks. Documented in `docs/sidebar-edge-reveal.md`. Verified by the focused Explorer layout unit tests (2 passing), resize-handle browser tests including the new right-anchored left-edge drag regression (5 passing), app typecheck, targeted lint, formatting check, and `git diff --check`. Electron maximized/fullscreen interaction was not exercised in a packaged runtime during this effort."
