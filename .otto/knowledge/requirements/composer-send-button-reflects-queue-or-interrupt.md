---
id: "composer-send-button-reflects-queue-or-interrupt"
kind: "requirement"
title: "Composer send button reflects Queue and Interrupt behavior"
status: "confirmed"
tags: ["composer", "send-behavior", "interaction-design"]
created_at: "2026-08-09T02:12:15.916Z"
updated_at: "2026-08-09T02:12:15.916Z"
---

# Composer send button reflects Queue and Interrupt behavior

<!-- compiled_truth -->

While an agent is running, the message composer's primary button uses the return/Enter glyph when Enter queues a message and the up-arrow when Enter sends immediately and interrupts the active turn.

## Timeline

- time: "2026-08-09T02:12:15.916Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-09T02:12:15.916Z"
  kind: "evidence"
  summary: "User direction in this chat on 2026-08-08; implementation and regression coverage in packages/app/src/composer/input/labels.ts, input.tsx, and labels.test.ts."
