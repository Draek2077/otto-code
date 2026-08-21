---
id: "composer-dismissal-is-permanent-discard"
kind: "requirement"
title: "Composer dismissal permanently discards unsent attachments"
status: "confirmed"
tags: ["composer","attachments","interaction","discard"]
created_at: "2026-08-21T03:00:50.818Z"
updated_at: "2026-08-21T03:02:08.438Z"
---
# Composer dismissal permanently discards unsent attachments

<!-- compiled_truth -->

The composer attachment X is a permanent discard action for the unsent item. Removing any item that was added to chat deletes its backing composer/context record so it cannot reappear or be sent later. This applies uniformly to review comments, meeting-note context, pull-request feedback, browser annotations, rendered-document annotations, chat-history context, file context, and future workspace attachment kinds. Review attachments also delete their underlying draft review comments. The discard does not delete a canonical external source that was merely copied into chat context, such as a retained meeting transcript or an upstream pull-request comment.

## Timeline

- time: "2026-08-21T03:00:50.818Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["diff-review-experience","rendered-markdown-comments-use-source-backed-block-locators","zoom-recorder-titlebar-transcript-library"]
- time: "2026-08-21T03:00:50.818Z"
  kind: "evidence"
  summary: "User explicitly broadened the requirement on 2026-08-20: anything added to chat and X-ed from the composer means “I’m not sending that” and must be deleted rather than temporarily hidden. Implementation in packages/app/src/composer/attachments/workspace.tsx now defaults every workspace attachment kind to backing-store removal, with focused coverage for review comments, meeting notes, PR feedback, browser annotations, rendered-document annotations, chat history, and file context."
- time: "2026-08-21T03:02:08.438Z"
  kind: "evidence"
  summary: "Verified the full dual-store lifecycle for review attachments: composer dismissal clears both the review-draft store and the published workspace attachment snapshot, so the item cannot return when suppression resets or the Changes publisher is unmounted. Successful send cleanup now removes every workspace attachment kind through the same generic type guard. Focused Vitest (10 tests), targeted lint, and app typecheck passed."
  source: "Implementation verification, 2026-08-20"
  affects: ["diff-review-experience","rendered-markdown-comments-use-source-backed-block-locators","zoom-recorder-titlebar-transcript-library"]
