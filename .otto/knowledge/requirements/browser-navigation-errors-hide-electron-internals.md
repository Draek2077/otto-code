---
id: "browser-navigation-errors-hide-electron-internals"
kind: "requirement"
title: "Browser navigation errors hide Electron internals"
status: "proposed"
tags: ["browser", "electron", "error-handling"]
created_at: "2026-08-09T18:00:52.060Z"
updated_at: "2026-08-09T18:06:52.192Z"
---

# Browser navigation errors hide Electron internals

<!-- compiled_truth -->

Electron browser navigation failures must present a user-facing browser error rather than raw Electron IPC or guest-view-manager diagnostics. DNS resolution failures are shown as the existing localized failed-to-load message.

## Timeline

- time: "2026-08-09T18:00:52.060Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-09T18:00:52.060Z"
  kind: "evidence"
  summary: "User reported `GUEST_VIEW_MANAGER_CALL: ERR_NAME_NOT_RESOLVED` rendered directly in the browser error UI. The renderer now sanitizes ERR_NAME_NOT_RESOLVED from both did-fail-load and rejected webview.loadURL paths."
- time: "2026-08-09T18:06:52.192Z"
  kind: "evidence"
  summary: "User requested normal-browser-style error pages: use the center of the browser view rather than an error bar at the top, and improve error pages generally. Implementation adds centered retryable page-unavailable UI and localized categories for DNS, refused/failed connections, and certificate errors."
  source: "User request"
