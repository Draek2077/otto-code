---
id: "zoom-chat-dnd-uses-default-timed-duration"
kind: "requirement"
title: "Zoom Chat DND uses a default timed duration"
status: "confirmed"
tags: ["zoom", "chat", "presence", "dnd", "integration-settings"]
created_at: "2026-08-15T04:55:51.531Z"
updated_at: "2026-08-15T04:55:51.531Z"
---

# Zoom Chat DND uses a default timed duration

<!-- compiled_truth -->

Selecting Do not disturb in the Zoom Chat popup directly requests a 20-minute Zoom DND window. Otto does not expose Zoom's custom-duration menu or a nested context menu for this operation. The duration is adapter-owned policy for now; a shared integration setting should be introduced only when multiple chat adapters demonstrate the same user-facing need.

## Timeline

- time: "2026-08-15T04:55:51.531Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["zoom-chat-popup-uses-live-presence-combobox","communications-prove-then-expand"]
- time: "2026-08-15T04:55:51.531Z"
  kind: "evidence"
  summary: "Explicit user direction, 2026-08-14. Current Zoom provider sends `duration: 20` with `Do_Not_Disturb`; the popup had incorrectly disabled this selection from normal statuses."
