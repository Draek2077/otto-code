---
id: "external-editor-markdown-override"
kind: "requirement"
title: "External file editors can keep Markdown in Otto"
status: "confirmed"
tags: ["editor","markdown","vim","neovim","custom-editor"]
created_at: "2026-08-21T05:10:50.454Z"
updated_at: "2026-08-21T05:10:50.454Z"
---
# External file editors can keep Markdown in Otto

<!-- compiled_truth -->

When the desktop File editor preference selects Vim, Neovim, or Custom, Editor settings provide an opt-in **Always use Otto editor for Markdown files** setting. When enabled, `.md` files always use Otto's built-in editor and Markdown preview; the selected external editor continues to open other eligible files. The setting defaults off to preserve the selected editor's existing behavior.

## Timeline

- time: "2026-08-21T05:10:50.454Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["vim-neovim-developer-workflows"]
- time: "2026-08-21T05:10:50.454Z"
  kind: "evidence"
  summary: "User requirement, 2026-08-20."
