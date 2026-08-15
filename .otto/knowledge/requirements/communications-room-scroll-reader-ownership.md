---
id: "communications-room-scroll-reader-ownership"
kind: "requirement"
title: "Communications room scroll honors reader ownership"
status: "confirmed"
tags: ["communications", "chat", "scrolling", "popup", "workspace-tabs"]
created_at: "2026-08-15T07:53:47.395Z"
updated_at: "2026-08-15T07:53:55.341Z"
---

# Communications room scroll honors reader ownership

<!-- compiled_truth -->

Communications Rooms follow the shared transcript ownership rule: while a reader is detached from the newest content, the room must not write the scroll position. New top-level messages, reply-thread children, historic thread expansion, and layout changes must preserve a detached reader’s inspection position. An attached reader may follow genuinely new content and viewport changes; explicit sends and the existing jump-to-latest affordance reattach the reader. The title-bar popup room and workspace-tab room share this policy. The popup Home/root list retains its own scroll position when back-navigation leaves a child room.

## Timeline

- time: "2026-08-15T07:53:47.395Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-15T07:53:47.395Z"
  kind: "evidence"
  summary: "Explicit user direction, 2026-08-15: implement only Communications Room scroll behavior; compare against AI chat retained scroll/bottom-anchor behavior; never scroll while the reader holds position; preserve older inspection across top-level and thread updates; share popup/workspace policy; and restore root-popup scroll separately on back navigation."
- time: "2026-08-15T07:53:55.341Z"
  kind: "evidence"
  summary: "Implemented reader-owned room scrolling with a fractional-safe bottom band, session-retained per-room offset and ownership state, explicit reattachment for sends/jump-to-latest, no anchoring on historic thread expansion, and a separately retained popup Home offset. Verified with `communications-room-scroll.test.ts` (3 focused tests), app typecheck, targeted lint, and formatting."
  source: "Implementation verification, 2026-08-15"
