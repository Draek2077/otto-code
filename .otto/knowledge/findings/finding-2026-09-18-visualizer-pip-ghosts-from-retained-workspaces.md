---
id: "finding-2026-09-18-visualizer-pip-ghosts-from-retained-workspaces"
kind: "finding"
title: "Visualizer ghosts: retained workspace portals create duplicate PIPs"
status: "proposed"
tags: ["visualizer","pip","workspace","portal","bug"]
created_at: "2026-09-18T22:09:07.677Z"
updated_at: "2026-09-18T22:26:04.905Z"
---
# Visualizer ghosts: retained workspace portals create duplicate PIPs

<!-- compiled_truth -->

## Verified finding

Inactive retained workspaces can leave their Visualizer PIPs visible in the window overlay. This creates a concrete common explanation for persistent duplicate visualizers and a ghost that appears during dragging and disappears on release. The defect is in shared web/Electron lifecycle logic; it does not require a Linux compositor fault.

`VisualizerPipHost` computes `shown` without `isVisible`. `VisualizerPip` portals its frame to `getOverlayRoot()` outside the hidden workspace container. The surface consumes visibility to pause its graph, but neither the host nor portal hides the frame. Each retained workspace can therefore contribute a visible, paused PIP.

During dragging, only the dragged instance changes its local fraction. On release, shared app settings broadcast the saved position to the other instances, stacking them together again. Separately, the drag hook rebases its initial zero-size container as if it were a real resize; a newly mounted PIP can resolve to an edge while an older instance keeps its saved position. This reproduced persistent separation after switching workspaces.

The user supplied a screenshot during this investigation showing three PIPs with distinct graph contents and totals, including Seed self-install and Live release. This supports separate workspace surfaces rather than a mere stale raster of one graph.

## Boundary and remediation direction

No production fix was applied. Native Linux Electron painting was not exercised. A separate compositor issue remains possible if ghosting survives with exactly one visualizer surface mounted. The earlier ordinary-View drag fix (44528e380) remains present but does not address inactive portal ownership.

The first remediation should enforce active-workspace visibility at the portal boundary, including immediate hiding on workspace deactivation despite exit-fade retention. Initial positioning should also distinguish first measurement from a subsequent resize and start dragging from the currently displayed offset. Verify workspace switching and mid-drag behavior with multiple retained workspaces before pursuing platform compositor changes.

Related: [[visualizer-pip-window-overlay-and-edge-anchoring]], [[visualizer-pip]].

## Timeline

- time: "2026-09-18T22:09:07.677Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["visualizer-pip","visualizer-pip-window-overlay-and-edge-anchoring"]
- time: "2026-09-18T22:09:07.677Z"
  kind: "evidence"
  summary: "2026-09-18 investigation at HEAD 9b05514b9. Source: packages/app/src/visualizer/visualizer-pip-host.tsx:72 (shown omits isVisible); visualizer-pip.tsx:294 (window portal); visualizer-surface.tsx:637 (pause only); use-visualizer-pip-drag.ts:135,157,162,217 (resize rebasing, local drag and shared commit); packages/app/src/components/retained-panel.tsx (display:none wrapper); workspace route WorkspaceDeckEntry and workspace-otto-controls.tsx (one PIP host per retained workspace).\n\nTemporary isolated Vitest/jsdom harness imported the production PIP host, PIP, drag hook, retained panel and overlay root; stubbed guest rendering, native styling/animation adapters, settings storage and unrelated hooks. Two behavioral tests passed with `npx vitest run --config .tmp/visualizer-ghost-investigation/vitest.config.ts .tmp/visualizer-ghost-investigation/repro.test.tsx --bail=1`. At 1024x768 with 240x150 PIP: before drag both frames were (784,0); during drag old remained (784,0) while current moved to (427,224); after release both were (427,224), still two portal surfaces. Second scenario dragged one PIP then mounted another workspace while retaining the old: old stayed (327,304), new resolved (0,0), and both persisted after 300ms (production fade is 200ms; harness animations disabled). These are component/DOM-state observations, not native compositor measurements. Scratch harness removed after investigation per repository rules.\n\nUser screenshot supplied in this chat shows three distinct floating visualizers simultaneously; user reported 'just did it'. Previous September 7 fix validation covered three geometry unit tests, lint and typecheck; its rollout explicitly lacked live rendered verification."
- time: "2026-09-18T22:26:04.905Z"
  kind: "evidence"
  summary: "User confirmed these were separate PIPs, normally stacked, and explicitly required one PIP or Visualizer tab per app window, with background mode the only exception and inactive guests unloaded. Implemented locally: a window-level PIP owner replaces per-workspace mounts; workspace changes tear down the old guest before initializing the next; tab opening retargets one tab or retires the old workspace tab; restored duplicates reconcile; inactive tabs, backgrounds and minimized app guests unmount. Removed PIP exit-hold overlap. Fixed first-measurement rebasing, drag starting from a stale saved fraction, and window listeners surviving unmount. 19 focused tests passed; app typecheck and targeted lint passed. docs/visualizer.md now specifies the lifecycle. Native Linux runtime behavior and the size of any performance improvement remain unmeasured. Requirement: [[visualizer-singleton-active-lifecycle]]."
  source: "2026-09-18 implementation and focused validation"
  affects: ["visualizer-singleton-active-lifecycle"]
