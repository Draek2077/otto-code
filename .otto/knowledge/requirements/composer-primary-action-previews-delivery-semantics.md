---
id: "composer-primary-action-previews-delivery-semantics"
kind: "requirement"
title: "Composer primary action previews delivery semantics"
status: "confirmed"
tags: ["composer","chat","keyboard-shortcuts","accessibility","visual-language"]
created_at: "2026-09-05T16:20:10.537Z"
updated_at: "2026-09-05T16:20:10.537Z"
---
# Composer primary action previews delivery semantics

<!-- compiled_truth -->

The composer primary action makes the exact action that Enter will perform legible. An idle chat shows **Send** with an accent up arrow. During an active turn, **Queue** shows the return/Enter arrow in accent, **Steer** shows a split/branch glyph in amber, and **Interrupt** shows the up arrow in destructive red. Holding Command/Ctrl previews the paired action with its corresponding glyph, tint, tooltip, and accessibility label. A compaction remains queue-only because it cannot safely accept a direct action.

## Timeline

- time: "2026-09-05T16:20:10.537Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["composer-controls-preserve-full-size-before-uniform-scaling"]
- time: "2026-09-05T16:20:10.537Z"
  kind: "evidence"
  summary: "User requirement on 2026-09-05: distinguish Send, Queue, Steer, and Interrupt in the composer and preview the exact action while Command/Ctrl is held; specifically requested amber for Steer and red for Interrupt. Implemented in `packages/app/src/composer/input/labels.ts` and `packages/app/src/composer/input/input.tsx`; focused label tests, targeted lint, formatter, app typecheck, and `git diff --check` passed."
