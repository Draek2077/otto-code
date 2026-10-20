---
id: "communications-reply-thread-existence-is-undiscoverable-without-opening-each"
kind: "finding"
title: "Communications reply/thread existence is undiscoverable without opening each message"
status: "proposed"
tags: ["communications", "zoom", "threads", "chat", "gap"]
created_at: "2026-08-15T08:13:56.473Z"
updated_at: "2026-08-15T08:13:56.473Z"
---

# Communications reply/thread existence is undiscoverable without opening each message

<!-- compiled_truth -->

Zoom Team Chat's message-list endpoint response, as parsed by `parseMessage()` in `zoom-team-chat-client.ts`, carries no reply-count or thread-count field. `CommunicationMessage.replyCount` in the protocol schema is therefore never populated by the server, so `communications-room.tsx`'s `hasReplies` check (`replies.length > 0 || (message.replyCount ?? 0) > 0`) stays false for every message until the user has already clicked Reply or Expand on that specific message and `loadThread` has run once. A room full of Zoom threads currently renders as flat messages with no visual indication that replies exist.

## Timeline

- time: "2026-08-15T08:13:56.473Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["provider-neutral-communications-hub","communications-nested-reply-action-gap","reference-zoom-team-chat-api"]
- time: "2026-08-15T08:13:56.473Z"
  kind: "evidence"
  summary: "Verified 2026-08-15 in `packages/server/src/server/communications/zoom-team-chat-client.ts`: `parseMessage()` reads `id`/`msg_id`, `message`, `sender_id`/`sender_user_id`, `sender_display_name`, a timestamp, `reply_main_message_id` (parent link only), and `reactions` — no reply-count or thread-count field is read from the wire payload. `toCommunicationMessage()` in `zoom-team-chat-provider.ts` likewise never sets `replyCount`. Attempted to confirm whether Zoom's `GET /chat/users/{userId}/messages` response documents a reply/thread-count field via Zoom's official docs and Zoom developer forum; the rendered docs page and forum threads found did not expose a field list or example payload confirming or ruling one out, so this is recorded as an open gap rather than a guessed field mapping. `replies` is only populated client-side after `loadThread()` runs, which only happens once the user has clicked Reply or Expand on that message."
