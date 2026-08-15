---
id: "zoom-chat-destination-search"
kind: "requirement"
title: "Zoom Chat destination search is limited to people and conversations"
status: "confirmed"
tags: ["zoom", "chat", "search", "title-bar", "provider-neutral"]
created_at: "2026-08-15T03:18:42.087Z"
updated_at: "2026-08-15T05:11:29.143Z"
---

# Zoom Chat destination search is limited to people and conversations

<!-- compiled_truth -->

The Zoom Team Chat title-bar popup uses one focused destination search for people and communication destinations. It returns only people, direct/group chats, and channels that the signed-in user can communicate with. It deliberately does not replicate Zoom global search categories such as message bodies, meetings, files, Canvas, apps, or administrative directories.

The popup presents concise result groups with enough context to choose correctly: a person’s display name, email, and presence when available; and a conversation’s title plus truthful kind label. Selecting a person opens or creates the corresponding direct-message destination; selecting a chat, group, or channel opens that conversation. Search remains daemon-owned so connected Otto frontends share the same secure provider access and no OAuth secret crosses the wire.

## Timeline

- time: "2026-08-15T03:18:42.087Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["communications-prove-then-expand","communications-titlebar-icon","zoom-settings-and-titlebar-entrypoints"]
- time: "2026-08-15T03:18:42.087Z"
  kind: "evidence"
  summary: "Explicit user direction, 2026-08-15, illustrated with Zoom’s contact and chat/channel search UI: keep only the useful people and channels/chats results, not Zoom’s bloated global-search categories. Zoom official Chat API documents server-side company-contact lookup (`GET /contacts`, `contact:read:list_contacts`, optional `query_presence_status`) and the signed-in user’s channel listing (`GET /chat/users/me/channels`, `team_chat:read:list_user_channels`)."
- time: "2026-08-15T03:33:33.576Z"
  kind: "evidence"
  summary: "Implemented the first destination-search slice. `communications.inbox.search.request` and `.response` are provider-neutral, feature-gated by `server_info.features.communicationsInboxSearch`, and use only optional protocol additions. Zoom maps company-contact matches from `GET /contacts` into direct-message destinations and filters the signed-in user's channel list in the daemon. The popup debounces searches for 300 ms, ignores stale responses, groups People before Chats & channels, and opens the existing conversation sheet on selection. Searches are bounded to six results per group and retained only in a 30-second in-memory daemon cache. Targeted provider/client tests, protocol test, shared client build, server/app typechecks, and target lint pass."
  source: "Implementation and targeted verification, 2026-08-15"
  affects: ["communications-prove-then-expand","communications-titlebar-icon"]
- time: "2026-08-15T03:42:58.668Z"
  kind: "evidence"
  summary: "Closed a production-shaped gap: Zoom Recent sessions and the user channel index are distinct feeds, so a destination visible in Recent could previously be absent from search. Search now reuses the daemon-cached Recent section from the Home sync, orders those matches before channel-index matches, and deduplicates by conversation id. This makes a recent group chat such as `Testing` searchable without another Zoom request on each keystroke. Targeted provider test (20 tests), lint, server typecheck, and server build pass."
  source: "Implementation and targeted verification, 2026-08-15"
  affects: ["communications-prove-then-expand","communications-titlebar-icon"]
- time: "2026-08-15T05:09:19.971Z"
  kind: "evidence"
  summary: "User report: Zoom's native search finds their contacts while Otto's destination search could return only the signed-in user. Root cause: Otto queried only the account-level company-directory endpoint (`GET /contacts`), which does not cover the signed-in user's external Team Chat contacts. The provider now combines that fast company lookup with `GET /chat/users/me/contacts?type=external`, deduplicates matches by contact identity, and caches the bounded external index for 30 seconds. The OAuth request now includes `team_chat:read:list_contacts`, so existing Zoom connections must reconnect once to grant it. Focused client/provider and OAuth authorization tests pass, along with targeted lint and server typecheck."
  source: "User report and implementation verification, 2026-08-14"
  affects: ["reference-zoom-team-chat-api"]
- time: "2026-08-15T05:11:29.143Z"
  kind: "evidence"
  summary: "Correction: the signed-in user's Zoom contact index must include both `type=company` and `type=external`, not only external contacts. Corporate Zoom policies can constrain the account-wide directory independently of the contact list shown to a user. The adapter now unions the server-filtered account directory with both user-contact types, deduplicates identities, and retains a 30-second cache. Google/Outlook cloud-contact syncing may appear in Zoom's desktop contacts surface, but Zoom's Team Chat APIs do not document an API that exposes arbitrary third-party cloud contacts as chat destinations; Otto therefore does not claim to search them unless Zoom returns them through one of these supported contact feeds. Focused client/provider/OAuth tests (42 tests), lint, and server typecheck pass."
  source: "Design correction and focused verification, 2026-08-14"
  affects: ["reference-zoom-team-chat-api"]
