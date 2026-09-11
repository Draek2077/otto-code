---
id: "workspace-splitters-remain-draggable-over-browser-panes"
kind: "requirement"
title: "Workspace splitters remain draggable over browser panes"
status: "proposed"
tags: ["workspace","split-panes","browser","interaction"]
created_at: "2026-09-11T16:33:32.874Z"
updated_at: "2026-09-11T19:20:44.299Z"
---
# Workspace splitters remain draggable over browser panes

<!-- compiled_truth -->

Workspace pane dividers must remain reachable and draggable with browser content on either side, including the horizontal divider between two browser panes stacked in a nested right-hand group. Workspace panes have no minimum size or minimum proportion; a pane reduced to zero can be expanded with its divider. Resizing keeps the adjacent pair's total allocation. Browser guests remain mounted while yielding pointer input for a resize; completion, cancellation, lost capture, window blur, and handle removal restore that input. Splitter grab areas follow nested layout movement and remain below menus and dialogs.

## Timeline

- time: "2026-09-11T16:33:32.874Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-09-11T16:33:32.874Z"
  kind: "evidence"
  summary: "2026-09-11: User reported that a single vertical divider works but the divider between two separate browser panes stacked on the right is frozen, and questioned pane minimum sizes. A Chromium component test reproduced resident browser content winning hit-testing at the shared ResizeHandle grab band before the repair, and passed after moving the grab band into the overlay root. The implementation also removes the 10% proportion floor and preserves zero during size normalization. Verification: resize-handle.browser.test.tsx passes 4 cases for pointerup, pointercancel, lostpointercapture and blur, each checking hit-testing, both drag directions, movement with sibling resizing, hidden-layout behavior and unmount cleanup; resize-handle-sizes.test.ts and workspace-layout-store.test.ts pass 128 unit tests. App typecheck, targeted lint, formatting and git diff --check pass. Browser fixtures substitute DOM elements for Electron guests and synthetic pointer capture; the user's installed-session failure and packaged Electron behavior were not directly verified. Durable contract: docs/design.md, Responsiveness."
- time: "2026-09-11T19:20:44.299Z"
  kind: "evidence"
  summary: "2026-09-11 follow-up: The user reported that browser layering still hides Otto UI even after drag input was repaired. Source audit found workspace DragOverlay, SplitDropZone visuals, and browser preview/error/annotation surfaces inside the app stacking context, beneath the permanent browser plane. The splitter-specific portal is now shared PaneOverlay/WindowOverlay primitives; splitter highlights join their hit areas in the foreground. Drop-target registration stays in the original pane while its visuals portal above guests. Pane overlays use parent layer + 1 and dragged tabs use +5, below menus/dialogs. Browser guests remain mounted. A new isolated real-Electron regression reproduces pane UI occluded by a guest, then verifies actual compositor pixel colors for pane UI, dragged preview, and an overlapping menu after applying production primitives. Foreground is created before the browser to prove insertion-order independence. Menu clicks, exposed-page hit target, guest CDP input, and guest identity retention pass. Hidden-window host-injected clicks do not reliably forward into guests, so the fixture tests guest input separately; this is not a full installed-app journey. Sixteen Chromium component regressions pass, including actual drop-preview bounds, error-card Reload hit-testing/retry, and splitter drag cleanup; app typecheck and targeted lint pass. No installed app update or restart was performed."
  source: "docs/design.md#9-responsiveness; docs/testing.md#desktop-browser-regression"
