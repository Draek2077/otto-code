---
id: "zoom-chat-favorites-are-native-starred-sessions"
kind: "requirement"
title: "Zoom Chat favorites use native starred sessions"
status: "confirmed"
tags: ["zoom", "chat", "favorites", "title-bar", "provider-neutral"]
created_at: "2026-08-15T03:59:04.188Z"
updated_at: "2026-08-15T05:04:27.739Z"
---

# Zoom Chat favorites use native starred sessions

<!-- compiled_truth -->

The Zoom Chat popup presents a Favorites section above Recent using Zoom’s native starred chat sessions. Favorites begins directly below the search field, without an intervening divider or spacer. Favorites and Recent use the same rich row presentation as search results: a direct-chat avatar or chat icon, strong title, contextual secondary detail, and a trailing favorite action when it is actionable. The authenticated user’s self-chat is excluded from Favorites because Zoom does not permit removing its native star. When the signed-in user’s own contact appears elsewhere, it remains selectable but carries no favorite control and the daemon rejects favorite mutations for it. Star/unstar uses Zoom’s `team_chat:update:chat_control` scope, which Otto requests during OAuth; an existing grant without that scope is told to reconnect rather than retry. Search results, Favorites, and other actionable chat destinations expose a star control: starring or unstarring always updates Zoom through the daemon-owned integration, and an existing actionable favorite exposes the same control to remove it. Otto does not maintain a duplicate local favorite list.

## Timeline

- time: "2026-08-15T03:59:04.188Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["zoom-chat-destination-search","reference-zoom-team-chat-api","integration-authorization-is-daemon-owned-and-reusable"]
- time: "2026-08-15T03:59:04.188Z"
  kind: "evidence"
  summary: "Explicit user direction, 2026-08-14. Zoom Team Chat API supports listing starred sessions and star/unstar mutation; Otto’s existing OAuth scopes already authorize both operations."
- time: "2026-08-15T04:12:47.783Z"
  kind: "evidence"
  summary: "Implemented Zoom-native Favorites in the title-bar Chat popup. The daemon reads starred sessions from `GET /chat/users/me/sessions`, exposes them above Recent through Chat Home, and mutates Zoom through `PATCH /chat/users/me/events` using `star` or `unstar`. The additive `communications.inbox.set_favorite` RPC returns a refreshed daemon-owned Home projection. Search results and home rows expose star controls, including removal from existing Favorites; search refreshes after each mutation. Added `communicationsFavorites` capability gate. Focused protocol and Zoom client/provider tests passed (43 tests); app and server typechecks, targeted lint, and formatting passed."
  source: "Implementation and targeted verification, 2026-08-14"
  affects: ["zoom-chat-destination-search","reference-zoom-team-chat-api"]
- time: "2026-08-15T04:32:17.913Z"
  kind: "evidence"
  summary: "Correction: `GET /chat/users/me/sessions` is not inherently a starred-session feed. It must include `search_star=true`; with that flag Zoom returns only starred 1:1 and group-chat sessions and prohibits `from`/`to` filters. The prior unfiltered request caused ordinary Recent entries to be rendered as Favorites, then Zoom correctly rejected `unstar` with 400 because those sessions were not starred. The adapter now sends `search_star=true`, with a focused regression test asserting the query."
  source: "Zoom Team Chat API, List a user's chat sessions (official Zoom Postman public workspace), verified 2026-08-14"
  affects: ["implementation-constraint-the-native-favorites-projection-must-request-only"]
- time: "2026-08-15T04:43:10.895Z"
  kind: "decision"
  summary: "User confirmed that Zoom’s own self-chat cannot be unfavorited and asked to omit it from Otto Favorites; provider now identifies the authenticated account by its OAuth-resolved email and excludes that one session."
  source: "Explicit user direction and verified provider behavior, 2026-08-14"
  affects: ["zoom-chat-destination-search","reference-zoom-team-chat-api"]
- time: "2026-08-15T04:47:46.543Z"
  kind: "decision"
  summary: "User confirmed the own-contact case must not expose a favorite toggle; the daemon now marks it non-actionable for the UI and enforces the same restriction server-side."
  source: "Explicit user direction and verified provider behavior, 2026-08-14"
  affects: ["zoom-chat-destination-search","reference-zoom-team-chat-api"]
- time: "2026-08-15T04:50:23.642Z"
  kind: "decision"
  summary: "User requested that Favorites and Recent match search results’ richer visual presentation; the shared popup rows now use equivalent icon, title, secondary-detail, spacing, and action treatment."
  source: "Explicit user direction, 2026-08-14"
  affects: ["zoom-chat-destination-search","zoom-chat-popup-uses-live-presence-combobox"]
- time: "2026-08-15T05:00:07.765Z"
  kind: "decision"
  summary: "Live failure showed the Zoom Marketplace scope was approved but omitted from Otto’s OAuth request and the existing grant. Added the operation to the active-scope contract and requested OAuth scopes, with a reconnect-specific preflight and UI message."
  source: "User-provided Zoom Marketplace screenshot and live daemon authorization metadata, 2026-08-14"
  affects: ["zoom-team-chat-oauth-completion-refreshes-automatically","reference-zoom-team-chat-api"]
- time: "2026-08-15T05:04:27.739Z"
  kind: "decision"
  summary: "User explicitly requested the gap and divider immediately above Favorites be removed."
  source: "Explicit user direction and implementation, 2026-08-14"
