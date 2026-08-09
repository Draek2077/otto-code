---
id: "chat-expand-collapse-controls-are-hover-revealed-and-cascade"
kind: "decision"
title: "Chat expand/collapse controls are hover-revealed and cascade"
status: "confirmed"
tags: ["chat", "interaction-design", "tool-calls"]
created_at: "2026-08-09T02:08:16.568Z"
updated_at: "2026-08-09T02:08:16.568Z"
---

# Chat expand/collapse controls are hover-revealed and cascade

<!-- compiled_truth -->

Chat action-group and overview expand/collapse controls are always available but, on web desktop, are revealed only while their parent badge is hovered. Native and compact layouts show them without hover. Expanding a parent expands all nested children; collapsing a parent collapses its children before closing the parent. There is no user setting for this behavior.

## Timeline

- time: "2026-08-09T02:08:16.568Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-09T02:08:16.568Z"
  kind: "evidence"
  summary: "User direction in this chat on 2026-08-08; implementation in packages/app/src/components/message.tsx, action-group.tsx, tool-calls/detail-level/overview/view.tsx, and agent-stream/view.tsx."
