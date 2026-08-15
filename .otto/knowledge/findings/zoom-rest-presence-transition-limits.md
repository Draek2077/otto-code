---
id: "zoom-rest-presence-transition-limits"
kind: "finding"
title: "Zoom REST presence transitions differ from the native client"
status: "confirmed"
tags: ["zoom", "chat", "presence", "api", "limitation"]
created_at: "2026-08-15T04:57:36.035Z"
updated_at: "2026-08-15T04:57:36.035Z"
---

# Zoom REST presence transitions differ from the native client

<!-- compiled_truth -->

Zoom's public presence API cannot enter Do not disturb for users on Zoom client 5.3.0 or later. It permits only Do not disturb → Away or Available, Available → Away, and Away → Available. The same documented transition table does not permit setting Busy. The native Zoom client can expose additional presence controls through a different, non-public path, so Otto must not offer those transitions through the REST integration.

## Timeline

- time: "2026-08-15T04:57:36.035Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["zoom-chat-popup-uses-live-presence-combobox","zoom-chat-dnd-uses-default-timed-duration"]
- time: "2026-08-15T04:57:36.035Z"
  kind: "evidence"
  summary: "Zoom Users API, Update a user's presence status, verified 2026-08-14: `PUT /users/{userId}/presence_status` documents the modern-client transition limits and separately documents DND's 1–1440-minute duration/default 20 minutes. https://developers.zoom.us/docs/api/users/"
