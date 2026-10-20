---
id: "zoom-team-chat-oauth-completion-refreshes-automatically"
kind: "requirement"
title: "Zoom Team Chat sign-in completion refreshes automatically"
status: "confirmed"
tags: ["zoom", "oauth", "team-chat", "settings"]
created_at: "2026-08-14T03:08:38.227Z"
updated_at: "2026-08-14T03:14:11.593Z"
---

# Zoom Team Chat sign-in completion refreshes automatically

<!-- compiled_truth -->

When a user completes the Zoom Team Chat OAuth browser flow, Otto automatically refreshes the daemon-owned authorization overview until it reaches a terminal connection state. The Settings UI must not continue showing a stale browser-open instruction after the daemon reports Connected, Error, or Reauthentication required.

## Timeline

- time: "2026-08-14T03:08:38.227Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["connectors"]
- time: "2026-08-14T03:08:38.227Z"
  kind: "evidence"
  summary: "User reported that Zoom sign-in completed in Zen Browser but Otto remained on the browser-open instruction; implementation now polls while authorizing and clears the stale notice."
- time: "2026-08-14T03:14:11.593Z"
  kind: "evidence"
  summary: "The live dev-daemon authorization metadata recorded `exchange_failed` after Zoom redirected to Otto's loopback callback. The callback reached the daemon, but the token exchange was rejected; no authorization code or token was retained in evidence. The callback listener previously closed before writing the browser response, producing Zen's misleading connection-refused page. The listener now closes only after the response finishes and preserves a safe HTTP-status diagnostic for a future retry."
  source: "Live OAuth diagnostic"
