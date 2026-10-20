---
id: "zoom-chat-popup-uses-live-presence-combobox"
kind: "requirement"
title: "Zoom Chat popup uses live presence combobox"
status: "confirmed"
tags: ["zoom", "chat", "title-bar", "presence", "ui"]
created_at: "2026-08-14T06:25:49.651Z"
updated_at: "2026-08-15T02:14:47.258Z"
---

# Zoom Chat popup uses live presence combobox

<!-- compiled_truth -->

The connected Zoom Chat title-bar popup places a compact status combobox at its top right and replaces any Manage or Settings shortcut there. The trigger truthfully displays the signed-in user's live Zoom presence, including Zoom-reported Offline. Available, Busy, Do not disturb, Away, and Out of office reflect or, where Zoom permits, change the signed-in user's Zoom presence through the daemon-owned integration.

Otto's local disable action is distinct from Zoom-reported Offline: it stops Otto Chat sync and interaction, turns the title-bar Chat control off, and retains OAuth credentials so re-enabling is immediate and shared by connected frontends. The UI must not infer that Zoom-reported Offline disables Otto or hide that observed provider status.

Zoom permits at most one presence-update HTTP request per user per minute. The daemon owns one universal cadence gate: user requests, deferred work, and retries all pass through the same gate, so there can never be more than one Zoom presence request in any sixty-second interval. A new selection replaces the daemon's single desired status rather than joining a queue. Once a request is sent, Otto reads Zoom to confirm it; if not confirmed, the same controller retries the latest desired status at the next eligible minute until it is confirmed or Otto Chat is locally disabled. Pending remains visible to every frontend while a desired status exists.

The daemon publishes every presence-state transition to capable connected frontends: local enable or disable, a new desired status, request cooldown, authoritative Zoom status or label changes, confirmation, and retry state. Each snapshot carries the daemon-measured remaining cooldown as well as its absolute deadline. The Desktop uses that duration to repaint the countdown every second without network chatter, which keeps remote-daemon UIs accurate even if their clocks differ. The popup renders Pending with `more_horiz`, exposes the daemon's live next-eligible-request countdown, and disables real Zoom-status choices while pending; Otto's local disable action remains immediately available because it does not call Zoom.

## Timeline

- time: "2026-08-14T06:25:49.651Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["communications-titlebar-icon","zoom-settings-and-titlebar-entrypoints","integration-authorization-is-daemon-owned-and-reusable"]
- time: "2026-08-14T06:25:49.651Z"
  kind: "evidence"
  summary: "Explicit user correction, 2026-08-14: the popup must have a top-right status combobox and the large Settings box is unacceptable. Implemented in `packages/app/src/screens/workspace/workspace-screen.tsx` with protocol RPCs and daemon provider mapping. Zoom's official Users API documents GET/PUT `/users/me/presence_status`, the `user:read:presence_status` and `user:update:presence_status` granular scopes, the one-update-per-minute limit, and the requirement that the user be logged into the Zoom client."
- time: "2026-08-14T15:15:28.322Z"
  kind: "decision"
  summary: "User clarified on 2026-08-14 that Offline means disconnecting Otto from Zoom Chat, not setting a real Zoom status."
  source: "Explicit user correction, 2026-08-14"
  affects: ["communications-titlebar-icon","integration-authorization-is-daemon-owned-and-reusable"]
- time: "2026-08-14T17:15:05.742Z"
  kind: "decision"
  summary: "User explicitly required the vendor timing rule to be daemon-owned and visibly gated in the Chat popup."
  source: "User direction and implementation verification, 2026-08-14"
  affects: ["communications-titlebar-icon","integration-authorization-is-daemon-owned-and-reusable"]
- time: "2026-08-14T18:03:33.650Z"
  kind: "decision"
  summary: "User required a stable daemon-owned desired-status queue with Pending display, retry, and confirmed-status rollback semantics."
  source: "User direction and implementation verification, 2026-08-14"
  affects: ["communications-titlebar-icon","integration-authorization-is-daemon-owned-and-reusable"]
- time: "2026-08-14T20:00:36.654Z"
  kind: "decision"
  summary: "User clarified that Zoom's observed Offline presence must be displayed truthfully even though Otto's local Offline choice disables Chat and has different semantics."
  source: "Explicit user correction, 2026-08-14"
  affects: ["communications-titlebar-icon","integration-authorization-is-daemon-owned-and-reusable"]
- time: "2026-08-15T01:46:18.693Z"
  kind: "evidence"
  summary: "Presence queue transitions must update an open popup live, including the visible “Status change is available in” countdown. Implemented a daemon-owned provider-neutral presence-change event, `communications.inbox.presence.changed.notification`, gated by `server_info.features.communicationsPresenceUpdates` and a client capability so older clients receive no unknown wire message. Zoom's provider publishes the initial Pending state, each retry cooldown, final confirmation, and final failure to all connected frontends."
  source: "Explicit user requirement and implementation verification, 2026-08-14"
  affects: ["communications-titlebar-icon","integration-authorization-is-daemon-owned-and-reusable"]
- time: "2026-08-15T02:04:03.669Z"
  kind: "decision"
  summary: "User clarified the vendor cadence is one universal one-minute HTTP-request gate, not separate user-change and retry timers."
  source: "Explicit user correction, 2026-08-14"
- time: "2026-08-15T02:14:47.258Z"
  kind: "decision"
  summary: "Implemented and verified live multi-frontend presence propagation with remote-daemon-safe countdown snapshots."
  source: "Explicit user requirement and targeted implementation verification, 2026-08-14"
