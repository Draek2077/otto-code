---
id: "keyboard-focus-rings-hug-control-borders"
kind: "requirement"
title: "Keyboard focus rings hug control borders"
status: "confirmed"
tags: ["accessibility", "focus", "theme", "ui"]
created_at: "2026-08-14T15:00:45.418Z"
updated_at: "2026-08-14T17:10:33.460Z"
---

# Keyboard focus rings hug control borders

<!-- compiled_truth -->

Keyboard-visible focus indication stays within the focused control’s bounds and uses the active theme accent. Controls that already own a 1px border expose focus by changing that border to the accent. `DropdownMenuTrigger` applies that treatment centrally whenever its caller owns a border; borderless icon triggers retain the shared in-bounds fallback without acquiring layout-changing border geometry. Independently focusable split-button segments use the shared split-button primitive: their exterior corners retain the correct radius and their shared divider colors with the focused segment. Focus treatment preserves existing interaction behavior and outer geometry. The pre-mount keyboard fallback draws its color from the live Unistyles `colors.accent` CSS variable.

## Timeline

- time: "2026-08-14T15:00:45.418Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-14T15:00:45.418Z"
  kind: "evidence"
  summary: "User direction on 2026-08-14: keyboard navigation highlighting should hug the highlighted element with no empty space between the control and outline. Implemented in packages/app/public/index.html and packages/app/src/components/ui/control-geometry.ts; targeted control geometry tests, app typecheck, and targeted lint passed."
- time: "2026-08-14T15:27:23.044Z"
  kind: "decision"
  summary: "The user refined the requirement on 2026-08-14: the focus indication must not extend outside a control and should use its 1px border."
  source: "User direction, 2026-08-14"
- time: "2026-08-14T15:47:40.302Z"
  kind: "decision"
  summary: "The user reported that a Daylight focus indicator appeared blue rather than using Daylight yellow. The focus fallback must use the active theme accent rather than a system-color-scheme proxy."
  source: "User direction and code correction, 2026-08-14"
- time: "2026-08-14T15:55:28.355Z"
  kind: "decision"
  summary: "The user identified dropdown and split-button triggers that did not inherit Button focus treatment. Their shared trigger primitive now owns the same in-bounds themed focus style."
  source: "User screenshots and packages/app/src/components/ui/dropdown-menu.tsx, 2026-08-14"
- time: "2026-08-14T16:05:25.875Z"
  kind: "decision"
  summary: "The user clarified that the dropdown focus defect was geometric, not chromatic: the inner outline was inset and did not follow the outer control’s rounded border. Focus must be painted on the border-owning frame without changing control behavior or outer size."
  source: "User screenshots and direction, 2026-08-14"
- time: "2026-08-14T16:12:30.481Z"
  kind: "decision"
  summary: "User requested the same in-bounds focus treatment for the two separately shaped halves of the Open in editor split button."
  source: "User direction and packages/app/src/screens/workspace/workspace-open-in-editor-button.tsx, 2026-08-14"
- time: "2026-08-14T17:08:43.751Z"
  kind: "decision"
  summary: "User required a systemic focus solution rather than individual dropdown and split-button call-site fixes; shared primitives now own the split geometry and focus handoff."
  source: "User direction and packages/app/src/components/ui/split-button.tsx, 2026-08-14"
- time: "2026-08-14T17:10:33.460Z"
  kind: "decision"
  summary: "The shared dropdown trigger now changes an existing border to the accent on focus, while retaining the fallback for borderless triggers."
  source: "packages/app/src/components/ui/dropdown-menu.tsx and user direction, 2026-08-14"
