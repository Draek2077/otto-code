---
id: "rendered-markdown-tables-use-single-owner-borders"
kind: "requirement"
title: "Rendered Markdown tables use single-owner borders"
status: "confirmed"
tags: ["markdown","tables","theme","borders","ui"]
created_at: "2026-08-21T14:44:02.704Z"
updated_at: "2026-08-21T14:45:05.340Z"
---
# Rendered Markdown tables use single-owner borders

<!-- compiled_truth -->

Rendered Markdown tables must present one coherent rounded shell in every light and dark theme. The outer table shell owns the outside border and clips header and cell backgrounds to its radius; rows and cells draw only internal separators, so the last body row and last cell do not duplicate the bottom or right edge. The invariant applies to every surface using the shared Markdown renderer, including assistant and user chat messages, rendered file previews, Project Knowledge, communications, and pull-request content.

## Timeline

- time: "2026-08-21T14:44:02.704Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["markdown-editing","file-preview-and-knowledge-articles-use-text-editor-canvas"]
- time: "2026-08-21T14:44:02.704Z"
  kind: "evidence"
  summary: "User-reported visual defect on 2026-08-21, with a light-theme screenshot showing incompatible rounded corners and visibly heavier top/bottom/right edges. The implementation path is packages/app/src/styles/markdown-styles.ts plus shared positional table rules in packages/app/src/components/markdown/renderer.tsx and explicit reuse by the assistant-message rules in packages/app/src/components/message.tsx."
- time: "2026-08-21T14:45:05.340Z"
  kind: "note"
  summary: "The user reviewed the rendered result on 2026-08-21, said it looks beautiful, and explicitly approved committing the fix. New status: confirmed."
