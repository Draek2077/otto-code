---
id: "composer-send-button-reflects-queue-or-interrupt"
kind: "requirement"
title: "Composer send button reflects Queue and Interrupt behavior"
status: "proposed"
tags: ["composer","send-behavior","interaction-design"]
created_at: "2026-08-09T02:12:15.916Z"
updated_at: "2026-08-29T14:00:41.094Z"
---
# Composer send button reflects Queue and Interrupt behavior

<!-- compiled_truth -->

While an agent is running, the message composer's primary button uses the return/Enter glyph when Enter queues a message and the up-arrow when Enter sends immediately and interrupts the active turn.

An in-flight context compaction is an exclusive maintenance turn: all composer submission paths queue prompts for delivery after compaction completes. The composer does not expose interruption during compaction, including through Escape, and queued-message “send now” / “send all” actions remain unavailable until it settles.

## Timeline

- time: "2026-08-09T02:12:15.916Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-09T02:12:15.916Z"
  kind: "evidence"
  summary: "User direction in this chat on 2026-08-08; implementation and regression coverage in packages/app/src/composer/input/labels.ts, input.tsx, and labels.test.ts."
- time: "2026-08-28T02:00:07.644Z"
  kind: "evidence"
  summary: "User manually verified in the desktop dev app that, with an active agent and a typed composer draft, holding Ctrl changes the primary composer action as intended. Earlier reports of no change reproduced an inactive-agent state, where this interaction is intentionally unavailable."
  source: "User verification in this chat, 2026-08-27"
  affects: ["composer-send-button-reflects-queue-or-interrupt"]
- time: "2026-08-29T14:00:41.094Z"
  kind: "decision"
  summary: "User clarified the behavior during an active compaction and the verified implementation now distinguishes it from ordinary generation. Status returned to proposed for review."
  source: "User direction and implementation verification, 2026-08-29"
