---
id: "markdown-outline-heading-level-markers-stay-single-line"
kind: "requirement"
title: "Markdown Outline heading-level markers stay single-line"
status: "proposed"
tags: ["text-editor","markdown","outline","ui"]
created_at: "2026-08-21T05:08:19.358Z"
updated_at: "2026-08-21T05:08:19.358Z"
---
# Markdown Outline heading-level markers stay single-line

<!-- compiled_truth -->

Markdown heading-level markers in the File Editor Outline must remain legible as a compact single-line `H1`–`H6` marker. Heading depth continues to convey hierarchy; a narrow marker column must never wrap its level number below the `H`.

## Timeline

- time: "2026-08-21T05:08:19.358Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["markdown-editing"]
- time: "2026-08-21T05:08:19.358Z"
  kind: "evidence"
  summary: "User feedback on 2026-08-20, with screenshot showing `H2` wrapping into two lines in the Outline. `packages/app/src/editor/editor-outline-sheet.tsx` used a 16px monospace glyph column for two-character heading markers; widened to 24px and constrained to one line."
