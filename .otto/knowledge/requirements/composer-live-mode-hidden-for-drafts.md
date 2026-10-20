---
id: "composer-live-mode-hidden-for-drafts"
kind: "requirement"
title: "Composer hides Live mode while a draft has content"
status: "confirmed"
tags: ["composer", "voice", "interaction-design"]
created_at: "2026-08-09T02:43:01.034Z"
updated_at: "2026-08-09T02:43:01.034Z"
---

# Composer hides Live mode while a draft has content

<!-- compiled_truth -->

The message composer hides the Live mode control whenever it contains sendable content on every form factor. Live mode does not use a typed draft, attachments, or other sendable content; the control returns once the composer is clear.

## Timeline

- time: "2026-08-09T02:43:01.034Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-09T02:43:01.034Z"
  kind: "evidence"
  summary: "User direction in this chat on 2026-08-08; implementation in packages/app/src/composer/index.tsx."
