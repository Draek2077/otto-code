---
id: "resident-browser-surfaces-preserve-app-owned-boundaries"
kind: "requirement"
title: "Resident browser surfaces preserve app-owned boundaries"
status: "confirmed"
tags: ["browser","desktop","webview","sidebar","splitter","interaction-design"]
created_at: "2026-09-20T01:37:08.187Z"
updated_at: "2026-09-20T01:37:08.187Z"
---
# Resident browser surfaces preserve app-owned boundaries

<!-- compiled_truth -->

On Electron desktop, a resident browser guest must stop at least one CSS pixel inside every pane edge while retaining its full browser viewport dimensions underneath that clip. The app owns those boundary pixels so a browser pane touching either outer window edge cannot block collapsed-sidebar reveal, and adjacent browser panes cannot block the existing splitter from receiving the pointer-down that begins resizing.

## Timeline

- time: "2026-09-20T01:37:08.187Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["swooped-sidebars-retain-inner-edge-resizing"]
- time: "2026-09-20T01:37:08.187Z"
  kind: "evidence"
  summary: "Explicit user requirement on 2026-09-19 after observing that browser panes at either window edge blocked sidebar reveal and side-by-side browser splitters were frozen. Implemented by insetting the resident browser surface in `packages/app/src/desktop/browser/resident-webviews.ts` while leaving the webview viewport dimensions unchanged. Focused browser tests verify fractional geometry, both full-width outer edges, a real side-by-side splitter pointer drag, and the previously corrected Explorer sidebar. 34 tests pass; app typecheck and targeted lint pass. Live Electron runtime confirmation of the browser boundary behavior remains pending."
