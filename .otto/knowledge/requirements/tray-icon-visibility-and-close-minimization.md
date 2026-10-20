---
id: "tray-icon-visibility-and-close-minimization"
kind: "requirement"
title: "Tray icon visibility is independent from close-to-tray"
status: "confirmed"
tags: ["desktop","tray","settings","window-lifecycle"]
created_at: "2026-08-25T02:43:44.909Z"
updated_at: "2026-08-25T02:43:44.909Z"
---
# Tray icon visibility is independent from close-to-tray

<!-- compiled_truth -->

On Electron desktop, **Show tray icon** is an explicit Desktop setting that keeps Otto's system-tray icon visible for the entire app lifetime while enabled and removes it while disabled. It is independent from **Minimize to tray on close**.

Close-to-tray only hides the last Windows/Linux window when both settings are enabled; otherwise closing proceeds as a normal quit path. Otto must never hide its only window when the tray icon is disabled. **Start minimized to tray** remains available but only takes effect when the tray icon is enabled.

## Timeline

- time: "2026-08-25T02:43:44.909Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-25T02:43:44.909Z"
  kind: "evidence"
  summary: "User requirement on 2026-08-24. Implemented in `packages/desktop/src/features/tray.ts`, `packages/desktop/src/main.ts`, and Desktop Settings UI; verified with focused desktop settings/tray and Settings catalog tests plus app and desktop typechecks."
