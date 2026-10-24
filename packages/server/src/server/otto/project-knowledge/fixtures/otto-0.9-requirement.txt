---
id: "knowledge-unconfirmed-status-is-draft"
kind: "requirement"
title: "Unconfirmed Knowledge entries use Draft status"
status: "confirmed"
tags: ["project-knowledge","ui-copy","terminology"]
created_at: "2026-08-10T01:21:36.698Z"
updated_at: "2026-09-06T14:59:44.588Z"
---
# Unconfirmed Knowledge entries use Draft status

<!-- compiled_truth -->

The Knowledge UI labels review status as Draft, Confirmed, and History.

## Timeline

- time: "2026-08-10T01:21:36.698Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["knowledge-creation-uses-new-entry"]
- time: "2026-08-10T01:21:36.698Z"
  kind: "evidence"
  summary: "User terminology decision on 2026-08-09: “Draft is also fine.”"
- time: "2026-08-10T01:21:55.782Z"
  kind: "decision"
  summary: "User replaced the preferred label set with “Draft/Confirmed/History” on 2026-08-09."
- time: "2026-08-10T01:24:28.697Z"
  kind: "decision"
  summary: "Removed unnecessary implementation commentary; the user specified only the preferred labels."
- time: "2026-09-06T14:56:33.923Z"
  kind: "reversal"
  summary: "The user replaced Draft with Pending for proposed records in the Product Knowledge screen on 2026-09-06. The current screen-specific requirement is [[product-knowledge-status-filters-prioritize-confirmed-current-knowledge]]. New status: superseded."
- time: "2026-09-06T14:59:44.588Z"
  kind: "note"
  summary: "Restore the record’s previous confirmed status after the user corrected the unrequested lifecycle-label rename on 2026-09-06. New status: confirmed."
