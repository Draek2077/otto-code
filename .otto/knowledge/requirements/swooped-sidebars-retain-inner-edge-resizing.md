---
id: "swooped-sidebars-retain-inner-edge-resizing"
kind: "requirement"
title: "Swooped sidebars retain inner-edge resizing"
status: "confirmed"
tags: ["sidebar","workspace","layout","desktop","interaction-design"]
created_at: "2026-09-19T22:20:14.699Z"
updated_at: "2026-09-20T01:36:58.442Z"
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
- time: "2026-09-20T00:59:50.059Z"
  kind: "evidence"
  summary: "Correction: the prior v0.9.17 implementation evidence was invalidated by user runtime testing. The docked Explorer lost its visible separator, and the swooped Explorer still could not be resized. The previous test only exercised an isolated generic split-pane ResizeHandle, not the rendered Explorer sidebar structure. Corrective work now routes both docked and swooped Explorer presentations through one ExplorerSidebarFrame that mirrors the working left sidebar: the panel owns a 1px inner border, SidebarResizeHandle on the inner edge, and SidebarSeamShadow. Targeted browser tests verify the rendered border and full-height separator in both presentations and the mirrored drag direction; app typecheck and targeted lint pass. Installed desktop runtime verification remains pending and this correction is not yet user-confirmed."
  source: "User runtime report on Otto v0.9.17 plus local source and browser-test verification on 2026-09-19"
  affects: ["packages-app-src-components-split-container-tsx","packages-app-src-components-explorer-sidebar-frame-tsx","packages-app-src-components-explorer-sidebar-frame-browser-test-tsx"]
- time: "2026-09-20T01:08:14.335Z"
  kind: "evidence"
  summary: "Follow-up correction: the user clarified that left and right are the same sidebar mechanism with different contents and rejected an Explorer-specific frame. The temporary ExplorerSidebarFrame was removed. The existing ExplorerSidebarDock now directly owns the existing SidebarResizeHandle on its left edge, the mirrored 1px structural border, and its existing SidebarSeamShadow; both docked and swooped presentations render that same dock. The resize gesture in SplitContainer mirrors the established left-sidebar pan configuration and uses the existing width resolver and persistence path. No new production resize component or mechanism remains. A browser test now renders the real ExplorerSidebarDock and verifies its visible 1px inner border and full-height shared separator. Five targeted browser tests, app typecheck, targeted lint, formatting, and diff checks pass. Installed desktop runtime verification remains pending."
  source: "User clarification and corrected local implementation on 2026-09-19"
  affects: ["packages-app-src-components-split-container-tsx","packages-app-src-screens-workspace-explorer-sidebar-tsx","packages-app-src-screens-workspace-explorer-sidebar-browser-test-tsx"]
- time: "2026-09-20T01:19:51.520Z"
  kind: "evidence"
  summary: "Second runtime correction: the user reported that the live right sidebar still was not a complete horizontal reflection of the working left sidebar. Source comparison found a real composition mismatch: the left sidebar paints content first, then SidebarResizeHandle, then SidebarSeamShadow, while the right sidebar had placed its handle before the Explorer content. The right shell now uses the same mirrored paint order and the same positioned, overflow-clipped outer shell. Verification also exposed that the first ExplorerSidebarDock browser fixture had zero height, making its full-height assertion a false positive. The corrected fixture is a real 320x300 stretched and clipped dock. It verifies the 1px hover highlight sits exactly on the left border, an interior point on that edge resolves through elementFromPoint to the shared resize handle, and a pointer drag from that hittable edge reaches the resize gesture. The focused browser tests, app typecheck, targeted lint, formatting, and diff checks pass. User runtime confirmation of this latest correction remains pending."
  source: "User runtime report and corrected rendered-browser verification on 2026-09-19"
  affects: ["packages-app-src-components-split-container-tsx","packages-app-src-screens-workspace-explorer-sidebar-tsx","packages-app-src-screens-workspace-explorer-sidebar-browser-test-tsx"]
- time: "2026-09-20T01:36:58.442Z"
  kind: "evidence"
  summary: "The user confirmed the final mirrored right-sidebar correction is now perfect in the running frontend. This validates that docked and swooped Explorer presentations retain the visible left-edge separator and resize interaction while matching the left sidebar's reflected composition."
  source: "User runtime confirmation in the development frontend on 2026-09-19"
