---
id: "file-preview-and-knowledge-articles-use-text-editor-canvas"
kind: "requirement"
title: "File preview and Knowledge articles use the Text Editor canvas"
status: "confirmed"
tags: ["editor", "file-preview", "project-knowledge", "themes"]
created_at: "2026-08-11T18:21:08.728Z"
updated_at: "2026-08-11T18:21:08.728Z"
---

# File preview and Knowledge articles use the Text Editor canvas

<!-- compiled_truth -->

The File Editor Preview content surface and the Manage Knowledge article canvas use the same `surfaceCode` background token as the Text Editor's editable content well. Pane headers, toolbars, and status bars retain their `surface0` chrome.

## Timeline

- time: "2026-08-11T18:21:08.728Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["knowledge-documents-use-pinned-header-toolbar"]
- time: "2026-08-11T18:21:08.728Z"
  kind: "evidence"
  summary: "User direction, 2026-08-11. Implemented in packages/app/src/components/file-pane.tsx and packages/app/src/project-knowledge/panel.tsx."
