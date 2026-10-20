---
id: "finding-2026-08-21-visualizer-pip-pre-guest-stall"
kind: "finding"
title: "Visualizer PiP could stall before creating its Electron guest"
status: "proposed"
tags: ["visualizer","pip","electron","diagnostics","client-state"]
created_at: "2026-08-22T02:04:12.846Z"
updated_at: "2026-08-22T02:04:12.846Z"
---
# Visualizer PiP could stall before creating its Electron guest

<!-- compiled_truth -->

# Observed failure

In a Windows dev session on 2026-08-21, collapsing a working Visualizer tab into PiP retired the tab guest and persisted the PiP-open setting, but the live renderer created no replacement Electron `<webview>`. A full `Ctrl+R` page reload then restored the persisted PiP state and created a healthy guest.

## Verified boundary

The failure occurred **before** `visualizer-view.electron.tsx` appended a guest. It was not a guest load failure, GPU/compositor failure, or Visualizer HTML-bundle failure:

- the original tab guest attached at 19:39:39.175 and reached `dom-ready` at 19:39:39.468;
- its last session-state line before the transition was 19:40:08.477;
- there was no attach, `did-fail-load`, renderer-gone, or no-dom-ready watchdog for a PiP guest after that transition;
- after the page refresh, a new guest attached at 19:40:48.489 and reached `dom-ready` at 19:40:48.781.

Because the original tab had already loaded the shared Visualizer HTML successfully and the PiP state survived reload, the unresolved fault is in the uninstrumented pre-guest path: most plausibly the first-time `React.lazy` import under `<Suspense fallback={null}>`, or the PiP anchor remaining behind its zero-size `onLayout` gate. The existing evidence cannot distinguish those two.

## Diagnostic implication

A future reproduction should log four transitions before changing behavior: `collapseToPip` completion, `VisualizerPipHost` `shown/mounted`, lazy import start/resolve/reject, and the first non-zero PiP anchor layout. Current Electron webview diagnostics begin too late to identify this class of failure.

## Timeline

- time: "2026-08-22T02:04:12.846Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["visualizer-pip"]
- time: "2026-08-22T02:04:12.846Z"
  kind: "evidence"
  summary: "Electron log `C:\\Users\\phili\\AppData\\Roaming\\Otto\\logs\\main.old.log`, lines 4468-4488, correlated with uploaded session export `packages/desktop/.dev/otto-home/uploads/upload_8fa41afa-272c-4a27-a78e-7a59d6cd16a4/visualizer pip.json`. Current code gates are `packages/app/src/visualizer/visualizer-pip-host.tsx` (settings/tab gate and null Suspense fallback), `packages/app/src/visualizer/visualizer-pip.tsx` (non-zero onLayout gate), and `packages/app/src/visualizer/visualizer-view.electron.tsx` (guest creation)."
