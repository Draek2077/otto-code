---
id: "composer-queue-move-controls-lead-each-row"
kind: "requirement"
title: "Composer queue move controls lead each row"
status: "confirmed"
tags: ["composer","message-queue","layout","interaction-design"]
created_at: "2026-08-21T15:36:32.359Z"
updated_at: "2026-08-21T15:36:32.359Z"
---
# Composer queue move controls lead each row

<!-- compiled_truth -->

In the Composer Message Queue stack, the paired up/down reorder control sits at the left edge of each queue row, before the queued message's attachment marker and label. The row retains its existing horizontal and vertical padding, control size, hit targets, disabled end-state affordances, and trailing edit/send actions.

## Timeline

- time: "2026-08-21T15:36:32.359Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T15:36:32.359Z"
  kind: "evidence"
  summary: "User requirement, 2026-08-21: “In the Composer Message Queue stack, we have up/down buttons to move things around. I would like to move those to be left most in the row (to the left of the label and any icons it might have), but keeping the normal padding of course.” Implemented in packages/app/src/composer/index.tsx; targeted formatter, lint, and app typecheck passed."
