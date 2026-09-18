---
id: "visualizer-singleton-active-lifecycle"
kind: "requirement"
title: "Visualizer has one active PIP or tab and unloads inactive guests"
status: "proposed"
tags: ["visualizer","pip","lifecycle","performance","workspace"]
created_at: "2026-09-18T22:26:02.511Z"
updated_at: "2026-09-18T22:44:43.040Z"
---
# Visualizer has one active PIP or tab and unloads inactive guests

<!-- compiled_truth -->

Each app window may have only one active PIP or Visualizer tab renderer. Workspaces retain their Visualizer tab descriptors, placement and targets when inactive; switching away tears down the guest, simulation and per-surface subscriptions without closing the tab. Returning to that workspace reinitializes its existing tab from chat history. Opening a Visualizer in another workspace, switching placement there, or reconciling that workspace's duplicate tabs must not delete inactive workspaces' saved tabs.

The window-level active-workspace owner controls which saved tab may initialize a guest. Inactive tab descriptors do not block the active workspace's PIP or chat backgrounds. Within a workspace, selecting another orchestration retargets its existing Visualizer tab. Chat background mode is the only exception to singleton renderer ownership, and hidden backgrounds still unload. Closing, minimization or changing placement releases inactive guests immediately; no exit fade retains a guest alongside its replacement. Lightweight tab state, settings and shared code may remain cached.

Related: [[visualizer-pip-window-overlay-and-edge-anchoring]].

## Timeline

- time: "2026-09-18T22:26:02.511Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["visualizer-pip"]
- time: "2026-09-18T22:26:02.511Z"
  kind: "evidence"
  summary: "User explicitly specified on 2026-09-18: 'There should never ever be more than 1 single PIP or Visualizer Tab. The only scenario now that allows multiple visualizers is background mode on chats.' Follow-up requested unloading inactive visualizers, with initialization and teardown when switching. Source implementation: VisualizerWindowProvider owns the PIP; visualizer-tab-owner coordinates window-wide tab ownership; inactive tab and background wrappers unmount VisualizerSurface. 19 focused tests passed (visualizer-window-host 8, open-visualizer-tab 5, use-visualizer-pip-drag 6), app typecheck and targeted lint passed. Native Linux rendering and performance savings have not been measured."
- time: "2026-09-18T22:27:12.528Z"
  kind: "decision"
  summary: "Keep confirmed-page links resolvable: the investigation remains a Draft finding, so reference it through evidence rather than a current-truth wiki link. Status returned to proposed for review."
- time: "2026-09-18T22:44:40.503Z"
  kind: "decision"
  summary: "User clarified that singleton ownership applies to active renderers, not saved workspace tabs. Switching workspaces must preserve the Visualizer tab and reinitialize it when returning."
  source: "User clarification and A-to-B-to-A regression, 2026-09-18"
- time: "2026-09-18T22:44:43.040Z"
  kind: "evidence"
  summary: "Corrected the initial implementation's global tab-closing behavior after the user's clarification. Saved tabs now survive across hosts and workspaces; only active-workspace renderer ownership changes. Verified A -> B -> A retains both original tab ids, produces mount:a / unmount:a / mount:b / unmount:b / mount:a, and never exceeds one live guest. Active-workspace tab reconciliation and placement changes preserve inactive workspace tabs. 14 focused tests passed in visualizer-window-host.test.tsx (9) and open-visualizer-tab.test.ts (5); app typecheck, targeted lint, formatting and git diff --check passed. Native Linux rendering remains unverified."
  source: "2026-09-18 correction validation"
