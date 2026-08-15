---
id: "zoom-team-chat-rate-limit-safe-home-sync"
kind: "finding"
title: "Zoom Team Chat Home sync is rate-limit safe"
status: "proposed"
tags: ["zoom", "team-chat", "rate-limits", "reliability"]
created_at: "2026-08-14T17:09:02.760Z"
updated_at: "2026-08-14T17:09:02.760Z"
---

# Zoom Team Chat Home sync is rate-limit safe

<!-- compiled_truth -->

Zoom Team Chat authentication can succeed while the first Chat Home load fails with HTTP 429 if Otto issues independent channel, session, shared-space, and presence reads concurrently or on repeated title-bar refreshes. The daemon must treat Team Chat reads as an account-limited stream: a lightweight overview uses a short shared cache, focused Home loading is coalesced and paced, and Otto-local availability changes must not depend on a fresh Zoom presence read.

## Timeline

- time: "2026-08-14T17:09:02.760Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["communications-prove-then-expand","zoom-chat-popup-uses-live-presence-combobox"]
- time: "2026-08-14T17:09:02.760Z"
  kind: "evidence"
  summary: "Verified against the local development daemon log on 2026-08-14: after a new Work-account OAuth grant, safe integration metadata reported state=connected and enabled=true while Zoom returned ZoomTeamChatApiError status 429 for /chat/users/me/channels, /chat/users/me/sessions, and /chat/spaces. Zoom's official API documentation states that HTTP 429 means a rate limit was exceeded and limits apply at account level. Implementation and focused tests in packages/server/src/server/communications/zoom-team-chat-{client,provider}.ts."
