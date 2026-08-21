---
id: "rendered-markdown-comments-use-source-backed-block-locators"
kind: "requirement"
title: "Rendered Markdown comments use source-backed block locators"
status: "confirmed"
tags: ["file-editor","preview","comments","attachments","markdown"]
created_at: "2026-08-21T02:34:45.860Z"
updated_at: "2026-08-21T03:18:14.024Z"
---
# Rendered Markdown comments use source-backed block locators

<!-- compiled_truth -->

File Editor Preview comments attach workspace-scoped context for Markdown renderer items with an exact markdown-it source map. For now, Markdown headings are the sole exposed entry point and every source-mapped heading keeps a compact comment glyph visible. An unannotated heading uses the add-comment glyph; an annotated heading uses the blue Chat glyph. Clicking either opens the shared Changes diff-comment editor directly below that heading; an existing comment is prefilled and Save replaces it. Saving remains valid from a File tab, which necessarily is not the focused agent tab; the workspace Composer displays the resulting attachment pill when its chat is active. Removing that pill removes the same workspace attachment, so the preview glyph disappears immediately. The attachment retains the workspace-relative path, item-kind locator, inclusive source line range, source excerpt, and user note, and directs the agent to read the current workspace file. Paragraph, blockquote, and fenced-code locators are retained for future renderer entry points but are not currently actionable. Converted AsciiDoc, standalone Mermaid, isolated HTML, images, and HTML-split nodes remain unsupported until they can provide an honest source locator.

## Timeline

- time: "2026-08-21T02:34:45.860Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T02:34:45.860Z"
  kind: "evidence"
  summary: "Implemented in packages/app/src/components/file-pane.tsx, components/markdown/annotation-locators.ts, attachment serialization, and docs/text-editor.md; focused Vitest, lint, and app typecheck passed."
- time: "2026-08-21T02:40:38.873Z"
  kind: "decision"
  summary: "The initial implementation had only an undiscoverable click target. User feedback established an explicit visible Comment control as part of the requirement."
  source: "User feedback, 2026-08-20"
- time: "2026-08-21T02:42:22.642Z"
  kind: "decision"
  summary: "Comment controls must remain discoverable when no focused chat exists, rather than disappearing with the unavailable destination."
  source: "User feedback, 2026-08-20"
- time: "2026-08-21T02:50:05.016Z"
  kind: "decision"
  summary: "User clarified the intended interim UX: a hover-revealed heading glyph and the existing Changes diff-comment box, not persistent controls on every rendered block."
  source: "User feedback, 2026-08-20"
- time: "2026-08-21T02:52:31.497Z"
  kind: "decision"
  summary: "Composer removal and preview glyph visibility are two projections of the same workspace attachment record; add regression coverage for the delete lifecycle."
  source: "User requirement, 2026-08-20"
- time: "2026-08-21T03:00:37.107Z"
  kind: "decision"
  summary: "User reported that the initial card was appended after the full rendered document and cancellation appeared to lock the control; the editor must remain adjacent to its source heading, while an unavailable focused-chat destination is shown as disabled."
  source: "User feedback, 2026-08-20"
- time: "2026-08-21T03:04:17.232Z"
  kind: "decision"
  summary: "A File tab is mutually exclusive with a focused agent tab, so rechecking focusedAgentId at Save silently discarded comments. Match Browser's workspace-scoped attachment semantics instead."
  source: "Implementation diagnosis and user report, 2026-08-20"
- time: "2026-08-21T03:09:24.358Z"
  kind: "decision"
  summary: "User requested that a saved heading marker visibly communicate editability and reopen the existing comment rather than begin a new one."
  source: "User feedback, 2026-08-20"
- time: "2026-08-21T03:18:14.024Z"
  kind: "decision"
  summary: "User reported inaccessible normal headings. This document has no actual HTML split, so make the affordance persistently visible on every source-mapped heading rather than relying on the failing hover path."
  source: "User feedback and focused regression test, 2026-08-20"
