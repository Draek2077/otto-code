---
id: "teams-submenu-back-control-is-compact"
kind: "requirement"
title: "Teams submenu back control is compact"
status: "proposed"
tags: ["teams", "popup", "desktop-ui", "navigation"]
created_at: "2026-08-14T16:13:09.555Z"
updated_at: "2026-08-14T16:13:09.555Z"
---

# Teams submenu back control is compact

<!-- compiled_truth -->

The desktop Teams popup uses a compact back control in submenu headers so the navigation affordance does not dominate the team-selection rows. This compact geometry applies to inline desktop combobox headers; full mobile sheet headers retain their larger touch-friendly back target.

## Timeline

- time: "2026-08-14T16:13:09.555Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-14T16:13:09.555Z"
  kind: "evidence"
  summary: "User screenshot and explicit UI correction, 2026-08-14. Implemented by giving `InlineHeaderView` its own 28px minimum-height back-button style in `packages/app/src/components/adaptive-modal-sheet.tsx`; the existing `SheetHeaderView` style remains unchanged. Targeted lint, app typecheck, and `active-team-switcher.test.tsx` passed."
