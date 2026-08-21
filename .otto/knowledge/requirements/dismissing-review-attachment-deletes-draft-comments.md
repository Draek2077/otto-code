---
id: "dismissing-review-attachment-deletes-draft-comments"
kind: "requirement"
title: "Dismissing a review attachment deletes its draft comments"
status: "superseded"
tags: ["diffs","code-review","composer","interaction"]
created_at: "2026-08-21T02:52:38.893Z"
updated_at: "2026-08-21T03:00:52.205Z"
---
# Dismissing a review attachment deletes its draft comments

<!-- compiled_truth -->

When the user dismisses a Changes review attachment from the chat composer with its remove control, Otto deletes the underlying draft review comments represented by that attachment and removes the attachment immediately. Dismissing unrelated composer attachments retains their existing source-specific behavior.

## Timeline

- time: "2026-08-21T02:52:38.893Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["diff-review-experience"]
- time: "2026-08-21T02:52:38.893Z"
  kind: "evidence"
  summary: "User requested this behavior on 2026-08-20. Implemented in packages/app/src/composer/attachments/workspace.tsx with regression coverage in packages/app/src/composer/attachments/workspace.test.ts."
- time: "2026-08-21T03:00:52.205Z"
  kind: "reversal"
  summary: "The user explicitly broadened this review-only rule to every unsent item added to chat; composer-dismissal-is-permanent-discard is the complete current requirement. New status: superseded."
