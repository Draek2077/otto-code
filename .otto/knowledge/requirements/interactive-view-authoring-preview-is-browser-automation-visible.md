---
id: "interactive-view-authoring-preview-is-browser-automation-visible"
kind: "requirement"
title: "Interactive View authoring preview is browser-automation visible"
status: "proposed"
tags: ["architectural-views","browser-tools","electron","agent-authoring"]
created_at: "2026-09-07T21:16:54.343Z"
updated_at: "2026-09-07T21:40:11.208Z"
---
# Interactive View authoring preview is browser-automation visible

<!-- compiled_truth -->

When an Interactive View is shown beside its bound authoring chat, its Archify HTML preview must be a toolbar-free, browser-automation-visible Otto guest. The preview retains the hardened self-contained document session and is scoped to the chat's workspace; ordinary artifacts remain outside browser automation. Its automation identity remains stable across live preview refreshes and is unregistered when the authoring chat tab closes. The authoring toolbar provides a Refresh action that fetches the latest rendered draft into that same guest.

## Timeline

- time: "2026-09-07T21:16:54.343Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["architectural-view-authoring-splitter-is-user-preference","browser-tab-registry"]
- time: "2026-09-07T21:16:54.343Z"
  kind: "evidence"
  summary: "User requirement, 2026-09-07. Implemented in `packages/app/src/components/artifacts/artifact-html-view.electron.tsx`, `packages/app/src/panels/agent-panel.tsx`, and desktop browser registration. Focused browser-webview registry test passed; app, server, and desktop typechecks passed. Live Electron rendering has not yet been run because the shared app was not restarted."
- time: "2026-09-07T21:40:11.208Z"
  kind: "decision"
  summary: "User explicitly requested a manual refresh action for the authoring preview."
  source: "User requirement, 2026-09-07."
