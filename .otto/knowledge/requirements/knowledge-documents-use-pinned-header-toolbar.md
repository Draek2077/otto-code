---
id: "knowledge-documents-use-pinned-header-toolbar"
kind: "requirement"
title: "Knowledge documents use a pinned header toolbar"
status: "confirmed"
tags: ["project-knowledge", "ui", "document-reader", "responsive-layout"]
created_at: "2026-08-11T07:03:38.861Z"
updated_at: "2026-08-11T07:37:33.277Z"
---

# Knowledge documents use a pinned header toolbar

<!-- compiled_truth -->

In the Manage Knowledge reader, a selected knowledge document renders its title as a large first heading inside the independently scrolling document content. The title has a 2px divider underline and the document body begins immediately beneath it. Its fixed header contains metadata only, with no repeated title. Its filename appears in a fixed footer styled as the Text Editor status bar, outside the document body. The document canvas uses the Text Editor background. Document actions render as icon-only compact toolbar controls with tooltips and the standard Text Editor toolbar chrome; they wrap when space is constrained and do not compete with the document content or require a horizontal scrollbar.

## Timeline

- time: "2026-08-11T07:03:38.861Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-11T07:03:38.861Z"
  kind: "evidence"
  summary: "User direction with reader screenshot, 2026-08-11. Implemented in packages/app/src/project-knowledge/panel.tsx."
- time: "2026-08-11T07:21:21.186Z"
  kind: "decision"
  summary: "User direction, 2026-08-11: move filename to an out-of-scroll status bar, make title and metadata the header content, use Text Editor toolbar chrome and background, and replace action labels with tooltips."
  source: "User direction, 2026-08-11"
- time: "2026-08-11T07:24:39.295Z"
  kind: "decision"
  summary: "User direction, 2026-08-11: remove the repeated document title from the top bar."
  source: "User direction, 2026-08-11"
- time: "2026-08-11T07:25:37.595Z"
  kind: "evidence"
  summary: "User direction, 2026-08-11: the selected document's header toolbar is 4px shorter than the shared Text Editor toolbar."
  source: "User direction, 2026-08-11"
- time: "2026-08-11T07:33:26.111Z"
  kind: "decision"
  summary: "User direction, 2026-08-11: restore the document title as the first heading inside the scrollable document content."
  source: "User direction, 2026-08-11"
- time: "2026-08-11T07:35:43.331Z"
  kind: "decision"
  summary: "User direction, 2026-08-11: use an 8px gap below the in-document title and add an underline."
  source: "User direction, 2026-08-11"
- time: "2026-08-11T07:36:13.941Z"
  kind: "decision"
  summary: "User direction, 2026-08-11: remove the extra gap after the in-document title underline."
  source: "User direction, 2026-08-11"
- time: "2026-08-11T07:36:57.461Z"
  kind: "decision"
  summary: "User direction, 2026-08-11: use a text underline on the in-document title instead of a divider rule."
  source: "User direction, 2026-08-11"
- time: "2026-08-11T07:37:33.277Z"
  kind: "decision"
  summary: "User direction, 2026-08-11: restore the divider-style underline and make it thicker."
  source: "User direction, 2026-08-11"
