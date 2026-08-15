---
id: "communications-prove-then-expand"
kind: "requirement"
title: "Communications prove then expand"
status: "confirmed"
tags: ["communications", "zoom", "delivery", "scope"]
created_at: "2026-08-13T23:16:25.626Z"
updated_at: "2026-08-14T06:15:47.774Z"
---

# Communications prove then expand

<!-- compiled_truth -->

Communications integrations begin as a narrow, simple proof and expand only after each capability is working reliably in Otto. Zoom Team Chat is the proof provider. Advanced synchronization, notifications, composition, AI context, and additional providers are separately gated by demonstrated reliability and explicit go/no-go review; no broad chat-client surface ships upfront.

## Timeline

- time: "2026-08-13T23:16:25.626Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["provider-neutral-communications-hub","communications-active-window-notification-restraint"]
- time: "2026-08-13T23:16:25.626Z"
  kind: "evidence"
  summary: "Explicit user direction, 2026-08-13: \"we will get to all that but i want to start small and simple to begin and fan out as we prove it working.\""
- time: "2026-08-13T23:25:04.608Z"
  kind: "evidence"
  summary: "The first proof slice is implemented as a read-only foundation only: `packages/protocol/src/communications.ts`, `packages/server/src/server/communications/communications-service.ts`, `communications.get_overview`, and `server_info.features.communications`. It returns an empty overview until a provider adapter is registered; no OAuth, Zoom HTTP calls, polling, sending, or UI behavior was introduced. Targeted protocol/service tests, full workspace typecheck, and targeted lint passed."
  source: "Implementation verification, 2026-08-13"
  affects: ["provider-neutral-communications-hub"]
- time: "2026-08-14T02:58:54.391Z"
  kind: "evidence"
  summary: "The Zoom proof now reaches one deliberate real-read boundary: after a successful managed connection, the daemon projects Zoom Team Chat's channel list into provider-neutral conversation summaries. It deliberately does not fetch message history, infer unread state, poll, send messages, or emit notifications. Focused OAuth/token/provider/service/protocol tests (16 tests), lint, and full workspace typecheck passed."
  source: "Implementation verification, 2026-08-13"
  affects: ["integration-authorization-is-daemon-owned-and-reusable","zoom-uses-otto-managed-authorization-only"]
- time: "2026-08-14T06:04:02.782Z"
  kind: "evidence"
  summary: "The user added the approved Zoom Team Chat scopes in Zoom Marketplace: user chat sessions, shared spaces, shared-space channels, and the already-discussed supporting permissions. The next proof slice may call these APIs after Otto reauthorization; it remains narrow and excludes Zoom apps, folders, notification delivery, and unsolicited polling."
  source: "Explicit user confirmation, 2026-08-14"
  affects: ["integration-authorization-is-daemon-owned-and-reusable","communications-titlebar-icon"]
- time: "2026-08-14T06:15:47.774Z"
  kind: "evidence"
  summary: "The next Zoom proof slice is implemented behind `server_info.features.communicationsChatHome`: `communications.inbox.get_home` returns a provider-neutral Chat Home of selectable conversations plus non-selectable collections. Zoom projects a bounded 30-day recent-session list, user channels, and shared spaces on demand when the title-bar popup opens. It does not poll, derive unread state, fetch shared-space channels yet, or expose folders that Zoom does not provide. `packages/protocol/src/messages.communications.test.ts` and Zoom client/provider tests (22 total) passed, along with focused lint and full workspace typecheck."
  source: "Implementation verification, 2026-08-14"
  affects: ["communications-titlebar-icon","integration-authorization-is-daemon-owned-and-reusable"]
