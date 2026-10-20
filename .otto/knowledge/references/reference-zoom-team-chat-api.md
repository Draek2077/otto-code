---
id: "reference-zoom-team-chat-api"
kind: "reference"
title: "Zoom Team Chat API"
status: "confirmed"
tags: ["zoom", "team-chat", "api", "search", "oauth"]
reference_disposition: "adopted"
source_url: "https://developers.zoom.us/docs/api/chat/"
created_at: "2026-08-15T03:19:43.525Z"
updated_at: "2026-08-15T05:30:57.446Z"
---

# Zoom Team Chat API

<!-- compiled_truth -->

Official Zoom API reference used for the Team Chat destination-search design. `GET /contacts` provides server-side company-contact lookup by first name, last name, or email through `search_key`, can include presence through `query_presence_status=true`, and requires granular scope `contact:read:list_contacts`. `GET /chat/users/me/contacts` lists a user's company or external contacts and requires `team_chat:read:list_contacts`. `GET /chat/users/{userId}/channels` lists the signed-in user's chat channels and requires `team_chat:read:list_user_channels`. All are MEDIUM rate-limit operations and paginated tokens expire after 15 minutes.

## Timeline

- time: "2026-08-15T03:19:43.525Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["zoom-chat-destination-search","communications-prove-then-expand"]
- time: "2026-08-15T03:19:43.525Z"
  kind: "evidence"
  summary: "Verified against current official Zoom Chat API reference on 2026-08-15. The search design uses the documented company-contact endpoint for people and filters the daemon-owned user channel list for channel destinations; it does not attempt to emulate unexposed Zoom global search categories."
- time: "2026-08-15T03:52:47.618Z"
  kind: "evidence"
  summary: "Zoom has a first-class starred-session system. `GET /chat/users/me/sessions` returns the user's starred chat sessions when queried without a date range, under `team_chat:read:list_user_sessions`; `PATCH /chat/users/me/events` stars or unstars one channel or contact under `team_chat:update:chat_control`. Otto's Zoom OAuth portal-approved and currently requested scope sets already include both scopes in `packages/server/src/server/communications/zoom-team-chat-oauth.ts`. The current client/provider implements only the date-ranged recent-session read and has no favorite/star read or mutation operation yet. Official source: https://developers.zoom.us/docs/api/chat/"
  source: "Zoom Team Chat API documentation verified 2026-08-14; Otto implementation inspection"
  affects: ["zoom-chat-destination-search"]
- time: "2026-08-15T04:32:19.549Z"
  kind: "evidence"
  summary: "Correction to earlier evidence: omitting the `search_star` parameter does not return only starred sessions. `GET /chat/users/me/sessions?search_star=true` is the native Starred query; it returns starred 1:1 and group-chat sessions and may not be combined with `from`/`to`. A live report showed unfiltered Recent entries incorrectly projected into Favorites and a 400 on unstar. The production adapter and focused test now require `search_star=true`."
  source: "Zoom Team Chat API, List a user's chat sessions (official Zoom Postman public workspace), verified 2026-08-14"
  affects: ["corrects-the-earlier-session-listing-interpretation-used-by-the-zoom-chat"]
- time: "2026-08-15T05:11:35.868Z"
  kind: "evidence"
  summary: "Destination search must combine supported feeds rather than assume one contact model. Zoom documents `/contacts` as an account company-directory search and `/chat/users/me/contacts` as the signed-in user's Company or External contact list, with the type required. Zoom Support documents that admins can limit directory visibility and external contacts, and that third-party Google/Outlook contact sync is a separate desktop Cloud Contacts feature. The public Team Chat API does not document an endpoint for arbitrary third-party cloud contacts as chat destinations."
  source: "Zoom official Chat API and Zoom Support contact documentation, verified 2026-08-14"
  affects: ["zoom-chat-destination-search"]
- time: "2026-08-15T05:30:57.446Z"
  kind: "evidence"
  summary: "The REST endpoint required to enumerate the signed-in user's Team Chat contacts (`GET /chat/users/me/contacts`) is limited by Zoom to a **user-managed** General OAuth app. Otto's current Zoom app registration rejects it with HTTP 400 after consent, which is consistent with an incompatible app-management type rather than a missing scope. The documented path is to switch the General app's Basic Info management type to User-managed, reconfirm scopes, and have users reauthorize. This is a Zoom Marketplace configuration change, not a second contacts-provider integration."
  source: "Zoom OAuth app creation documentation and live endpoint behavior, verified 2026-08-14"
  affects: ["zoom-chat-destination-search"]
