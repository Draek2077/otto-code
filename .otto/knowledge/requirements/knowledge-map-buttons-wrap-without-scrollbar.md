---
id: "knowledge-map-buttons-wrap-without-scrollbar"
kind: "requirement"
title: "Knowledge Map buttons wrap without an internal scrollbar"
status: "proposed"
tags: ["project-knowledge","ui","responsive-layout"]
created_at: "2026-08-11T06:44:28.048Z"
updated_at: "2026-09-13T04:45:22.729Z"
---
# Knowledge Map buttons wrap without an internal scrollbar

<!-- compiled_truth -->

The Manage Knowledge panel's Knowledge map section is collapsible and starts collapsed. Expanding it reveals the root-page buttons, which wrap onto additional lines when sidebar width is constrained. The section must not use a horizontal scrollbar for these navigation controls.

## Timeline

- time: "2026-08-11T06:44:28.048Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-11T06:44:28.048Z"
  kind: "evidence"
  summary: "User request, 2026-08-11: \"In Manage knowledge page, the 'Knowledge Map' section has a scrollbar and should really wrap instead.\" Code change in packages/app/src/project-knowledge/panel.tsx."
- time: "2026-09-13T04:45:22.729Z"
  kind: "decision"
  summary: "User requested a collapsible Knowledge Map section, collapsed by default, to reduce the oversized top section. Implemented in packages/app/src/project-knowledge/panel.tsx and documented in docs/project-knowledge.md. App typecheck and targeted lint passed; browser visual verification remains pending because no preview server or browser tab is running. Status returned to proposed for review."
  source: "User request, 2026-09-12"
