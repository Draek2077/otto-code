---
id: "resident-browser-surfaces-preserve-app-owned-boundaries"
kind: "requirement"
title: "Resident browser surfaces preserve app-owned boundaries"
status: "confirmed"
tags: ["browser","desktop","webview","sidebar","splitter","interaction-design"]
created_at: "2026-09-20T01:37:08.187Z"
updated_at: "2026-09-20T13:38:50.993Z"
---
# Resident browser surfaces preserve app-owned boundaries

<!-- compiled_truth -->

On Electron desktop, resident browser guests remain visually edge-to-edge with their pane. Browser-specific input bridging, not a persistent clipped gutter or visible border, forwards horizontal-edge pointer movement into the same collapsed-sidebar reveal controller used by ordinary tabs and briefly yields guest input to the existing splitters. While a floating sidebar is mounted, browser input is suspended so the overlay remains interactive.

## Timeline

- time: "2026-09-20T01:37:08.187Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["swooped-sidebars-retain-inner-edge-resizing"]
- time: "2026-09-20T01:37:08.187Z"
  kind: "evidence"
  summary: "Explicit user requirement on 2026-09-19 after observing that browser panes at either window edge blocked sidebar reveal and side-by-side browser splitters were frozen. Implemented by insetting the resident browser surface in `packages/app/src/desktop/browser/resident-webviews.ts` while leaving the webview viewport dimensions unchanged. Focused browser tests verify fractional geometry, both full-width outer edges, a real side-by-side splitter pointer drag, and the previously corrected Explorer sidebar. 34 tests pass; app typecheck and targeted lint pass. Live Electron runtime confirmation of the browser boundary behavior remains pending."
- time: "2026-09-20T13:03:02.027Z"
  kind: "evidence"
  summary: "The user reported that the app-owned browser boundary painted as a stark, uneven white frame around the page. Source inspection found the geometry anchor in `packages/app/src/desktop/browser/pane/index.electron.tsx` hard-coded to `#ffffff`; inward rounding could expose one or two pixels of that anchor while reserving pointer input. The anchor is now transparent, allowing the surrounding Otto pane surface to show through while the resident guest retains its own white backing, full viewport dimensions, and unchanged edge clipping. The rendered browser-pane regression verifies the boundary underlay is transparent. The focused browser test (22 tests), app typecheck, targeted lint, formatting, and diff checks pass. Live Electron visual confirmation of the corrected edge remains pending."
  source: "User screenshot and local source/browser-test verification on 2026-09-20"
  affects: ["packages-app-src-desktop-browser-pane-index-electron-tsx","packages-app-src-desktop-browser-pane-loading-browser-test-tsx","docs-sidebar-edge-reveal-md"]
- time: "2026-09-20T13:10:07.749Z"
  kind: "evidence"
  summary: "Runtime correction: the transparent-anchor change alone was incomplete. The user's development-app screenshot still showed a pure-white boundary around two resident browser panes. Pixel inspection measured the line as exactly one CSS pixel at the 200% capture scale, confirming that the reserved input gutter was falling through to Electron's white backing rather than showing a guest focus outline. The browser clip in `packages/app/src/desktop/browser/pane/index.electron.tsx` now explicitly paints `theme.colors.surface0`; fixed-device previews keep their later `surface1` override. The anchor remains transparent. The rendered regression now verifies both properties: transparent anchor plus an opaque, non-white immediate clip underlay. The focused browser test (22 tests), app typecheck, targeted lint, formatting, and diff checks pass. Live visual confirmation of this follow-up correction remains pending."
  source: "User runtime screenshot from the development app and local source/browser-test verification on 2026-09-20"
  affects: ["packages-app-src-desktop-browser-pane-index-electron-tsx","packages-app-src-desktop-browser-pane-loading-browser-test-tsx"]
- time: "2026-09-20T13:24:09.057Z"
  kind: "decision"
  summary: "The user explicitly clarified that the browser must remain edge-to-edge and that normal tabs already demonstrate the intended floating-sidebar behavior. The prior one-pixel app-owned gutter solved hit-testing by visibly shrinking the browser, producing an unacceptable perimeter. The implementation now keeps full-bleed geometry and bridges only the browser guest's edge input into the existing app-owned interactions. Status returned to proposed for review."
  source: "User clarification and focused local verification on 2026-09-20"
  affects: ["swooped-sidebars-retain-inner-edge-resizing","swooped-sidebars-remain-transient-and-layer-above-visualizer"]
- time: "2026-09-20T13:24:36.432Z"
  kind: "note"
  summary: "The user explicitly required browser surfaces to remain edge-to-edge and identified the normal-tab floating-sidebar behavior as the intended contract. New status: confirmed."
- time: "2026-09-20T13:38:50.993Z"
  kind: "evidence"
  summary: "Runtime correction to the edge-input bridge: the first implementation passed renderer unit tests but failed in the live app because `guest-preload.ts` imported a neighboring runtime module. Electron sandboxed guest preloads cannot resolve that local runtime import, so the preload failed before registering its mouse listener. The bridge is now self-contained inside the preload. A new real-Electron regression builds the production preload, attaches it to a sandboxed `<webview>`, dispatches trusted guest mouse movement, and verifies the `otto-browser-edge-pointer` IPC message reaches the host. That Electron regression passes, along with 64 focused app browser tests, app and desktop typechecks, targeted lint, formatting, and diff checks. User confirmation in the running development app is still pending because an already-attached guest must be recreated to load a changed preload."
  source: "User runtime report plus real Electron sandboxed-webview regression on 2026-09-20"
  affects: ["packages-desktop-src-features-browser-keyboard-guest-preload-ts","packages-desktop-e2e-browser-edge-pointer-e2e-cjs","packages-app-src-desktop-browser-resident-webviews-ts"]
