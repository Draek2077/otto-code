---
id: "segmented-button-bars-wrap-when-constrained"
kind: "requirement"
title: "Segmented button bars wrap when constrained"
status: "confirmed"
tags: ["ui", "responsive-layout", "settings"]
created_at: "2026-08-11T04:00:12.416Z"
updated_at: "2026-08-11T04:00:50.022Z"
---

# Segmented button bars wrap when constrained

<!-- compiled_truth -->

Segmented button bars must wrap their items onto additional lines on compact layouts when the available width cannot contain every item, rather than clipping or overflowing. Non-compact layouts retain single-line bars unless a caller explicitly requests wrapping.

## Timeline

- time: "2026-08-11T04:00:12.416Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-11T04:00:12.416Z"
  kind: "evidence"
  summary: "User request with settings screenshot on 2026-08-10; implementation defaults `SegmentedControl` wrapping in `packages/app/src/components/ui/segmented-control.tsx`."
- time: "2026-08-11T04:00:50.022Z"
  kind: "decision"
  summary: "The user clarified on 2026-08-10 that automatic wrapping is intended by default in mobile/compact mode, not at every viewport width."
  source: "User clarification"
