---
id: "communications-nested-reply-action-gap"
kind: "finding"
title: "Communications nested reply action gap"
status: "proposed"
tags: ["communications", "chat", "threads", "ui", "audit"]
created_at: "2026-08-15T07:50:40.026Z"
updated_at: "2026-08-15T07:50:40.026Z"
---

# Communications nested reply action gap

<!-- compiled_truth -->

The shared Communications Room renderer currently permits Reply on top-level messages only. Replies rendered inside an expanded branch retain reactions but do not expose the Reply action, so a child message cannot be targeted for a further reply. This does not change the established room requirement; it records the verified implementation gap for follow-up.

## Timeline

- time: "2026-08-15T07:50:40.026Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["communications-conversation-tabs-are-distinct-from-ai-chats","provider-neutral-communications-hub"]
- time: "2026-08-15T07:50:40.026Z"
  kind: "evidence"
  summary: "Verified in `packages/app/src/screens/workspace/communications-room.tsx` on 2026-08-15: `RoomMessage` renders each `replies.map(...)` child with `canReply={false}` and an inert `onReply={() => undefined}`. Repro: open a top-level message with replies, expand its branch, then inspect or keyboard-navigate a child reply. The child shows reactions when enabled but has no Reply action. The confirmed [[communications-conversation-tabs-are-distinct-from-ai-chats]] requirement says every nested message is an actionable target."
