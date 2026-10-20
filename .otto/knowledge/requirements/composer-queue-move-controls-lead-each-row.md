---
id: "composer-queue-move-controls-lead-each-row"
kind: "requirement"
title: "Composer queue move controls lead each row"
status: "confirmed"
tags: ["composer","message-queue","layout","interaction-design"]
created_at: "2026-08-21T15:36:32.359Z"
updated_at: "2026-09-06T01:34:41.356Z"
---
# Composer queue move controls lead each row

<!-- compiled_truth -->

In the Composer Message Queue stack, the paired up/down reorder control sits at the left edge of each queue row, before the queued message's attachment marker and label. Only the queue head's first five rows render; remaining queued items stay intact and become visible as earlier entries are sent, edited, or otherwise removed. The row uses compact content padding (`theme.spacing[2]` horizontally and `theme.spacing[1]` vertically) while retaining its control size, hit targets, disabled end-state affordances, and trailing edit/send actions.

## Timeline

- time: "2026-08-21T15:36:32.359Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T15:36:32.359Z"
  kind: "evidence"
  summary: "User requirement, 2026-08-21: “In the Composer Message Queue stack, we have up/down buttons to move things around. I would like to move those to be left most in the row (to the left of the label and any icons it might have), but keeping the normal padding of course.” Implemented in packages/app/src/composer/index.tsx; targeted formatter, lint, and app typecheck passed."
- time: "2026-09-06T01:28:06.494Z"
  kind: "decision"
  summary: "User requirement on 2026-09-05: limit the visible queue to five items and reduce each row's border padding so a long queue does not take over the Composer. Status returned to proposed for review."
  source: "User request, 2026-09-05; implemented in packages/app/src/composer/index.tsx and covered by the queued-message browser regression."
- time: "2026-09-06T01:34:36.409Z"
  kind: "decision"
  summary: "Correct verification provenance: the focused browser harness did not pass its Metro startup in this shared workspace. The implemented queue-window behavior is instead covered by the deterministic unit regression at packages/app/src/composer/queue-visible-window.test.ts, which passed."
  source: "User request, 2026-09-05; implementation in packages/app/src/composer/index.tsx. Verified by the focused unit regression at packages/app/src/composer/queue-visi"
- time: "2026-09-06T01:34:41.356Z"
  kind: "note"
  summary: "The user explicitly requested the five-row visibility cap and compact queue-row padding on 2026-09-05; implementation and targeted verification are complete. New status: confirmed."
