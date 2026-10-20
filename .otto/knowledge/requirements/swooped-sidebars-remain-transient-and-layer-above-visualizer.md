---
id: "swooped-sidebars-remain-transient-and-layer-above-visualizer"
kind: "requirement"
title: "Swooped sidebars remain transient and layer above the Visualizer"
status: "confirmed"
tags: ["sidebar","workspace","visualizer","desktop","overlay","interaction-design"]
created_at: "2026-09-19T22:33:22.649Z"
updated_at: "2026-09-20T00:59:58.336Z"
---
# Swooped sidebars remain transient and layer above the Visualizer

<!-- compiled_truth -->

While a collapsed sidebar is temporarily revealed from a screen edge, interactions inside it do not change the sidebar's persistent open state. In particular, switching tabs in the swooped right-side Explorer selects the tab while preserving the pane's hidden state; only an explicit pin/open action makes it docked. In the window overlay plane, ambient Visualizer PIP content paints below a swooped sidebar, while tab drags, menus, dialogs, and other interaction overlays paint above it. Docked sidebars remain in ordinary layout and do not cover the window-wide PIP.

## Timeline

- time: "2026-09-19T22:33:22.649Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["swooped-sidebars-retain-inner-edge-resizing","visualizer-pip-window-overlay-and-edge-anchoring"]
- time: "2026-09-19T22:33:22.649Z"
  kind: "evidence"
  summary: "Requested explicitly by the user on 2026-09-19. The tab-selection root cause was `focusTabInPane` clearing `hidden` even through `selectTabInPaneInLayout`; the selection path now preserves hidden state while focus/reveal paths keep their existing behavior. The PIP had reused the pane-local `CHAT_PANE_OVERLAY_Z.visualizerPip` value inside the window overlay root; it now uses the root's explicit `OVERLAY_Z.visualizerPip` slot below `sidebarPeek`. Implemented in `workspace-layout-actions.ts`, `overlay-root.ts`, and `visualizer-pip.tsx`, with the contract in `docs/sidebar-edge-reveal.md`. Verified by 126 workspace-layout tests, 5 overlay-root tests, app typecheck, targeted lint, formatting check, and `git diff --check`. Maximized/fullscreen Electron interaction remains unverified in a packaged runtime."
- time: "2026-09-20T00:59:58.336Z"
  kind: "evidence"
  summary: "The user confirmed that floating sidebars now render above the Visualizer in the released v0.9.17 build. This validates the overlay-layering portion of the change, independently of the separate right-sidebar resize regression."
  source: "User runtime confirmation on Otto v0.9.17, 2026-09-19"
