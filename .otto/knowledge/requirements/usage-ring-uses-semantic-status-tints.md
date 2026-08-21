---
id: "usage-ring-uses-semantic-status-tints"
kind: "requirement"
title: "Usage Ring uses semantic status tints"
status: "confirmed"
tags: ["ui","theme","composer","semantic-status"]
created_at: "2026-08-21T17:07:08.454Z"
updated_at: "2026-08-21T17:07:08.454Z"
---
# Usage Ring uses semantic status tints

<!-- compiled_truth -->

# Requirement

The composer Usage Ring uses the theme-aware semantic status tints: `statusSuccess` below 40% context occupancy, `statusWarning` from 40% through 59%, and `statusDanger` at 60% or more. The tokens must be delivered with scoped theme references so the ring remains correct inside the black chat surface.

## Timeline

- time: "2026-08-21T17:07:08.454Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["theme-aware-ui-state-gallery"]
- time: "2026-08-21T17:07:08.454Z"
  kind: "evidence"
  summary: "User direction on 2026-08-21: use the standard green, amber, and red tint colors. Implemented in `packages/app/src/components/context-window-meter.tsx` by replacing raw palette and `destructive` colors with scoped semantic status tokens."
