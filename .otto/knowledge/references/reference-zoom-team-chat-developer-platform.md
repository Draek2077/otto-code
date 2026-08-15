---
id: "reference-zoom-team-chat-developer-platform"
kind: "reference"
title: "Zoom Team Chat Developer Platform"
status: "proposed"
tags: ["zoom", "oauth", "team-chat", "webhooks"]
reference_disposition: "read"
source_url: "https://developers.zoom.us/docs/api/chat/"
created_at: "2026-08-13T23:03:35.583Z"
updated_at: "2026-08-14T00:26:53.013Z"
---

# Zoom Team Chat Developer Platform

<!-- compiled_truth -->

Zoom Team Chat is viable as the proof adapter through user-managed OAuth, REST Chat APIs, and event subscriptions. Its current granular scopes support user channels, sessions, messages, send, thread retrieval, contacts, and message status updates. The platform requires a public/reachable validated webhook endpoint for real-time events, and public/unlisted app distribution requires Marketplace review. Zoom public-client PKCE supports a client without a secret, but remote daemon redirect/rendezvous and the exact public-client refresh call must be verified before implementation. The project should use Zoom only behind a provider-neutral communications contract and keep Team Chat separate from meeting transcription.

## Timeline

- time: "2026-08-13T23:03:35.583Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["provider-neutral-communications-hub"]
- time: "2026-08-13T23:03:35.583Z"
  kind: "evidence"
  summary: "Official Zoom documentation checked 2026-08-13: OAuth/PKCE, Chat endpoints and granular scopes, webhook verification/72-hour revalidation, marketplace review/distribution, and account-level rate limits."
- time: "2026-08-14T00:26:53.013Z"
  kind: "evidence"
  summary: "2026-08-13 implementation evidence: Zoom Team Chat adapter uses GET /chat/users/me/channels, GET /chat/users/me/messages (with date and one channel/contact target), and POST /chat/users/me/messages. Official docs identify granular chat scopes including team_chat:read:list_user_messages and team_chat:write:user_message, and list send-message rate limit label MEDIUM."
  source: "Zoom Developer Docs: Chat APIs and OAuth granular scopes"
