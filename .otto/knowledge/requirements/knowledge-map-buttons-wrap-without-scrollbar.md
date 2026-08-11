---
id: "knowledge-map-buttons-wrap-without-scrollbar"
kind: "requirement"
title: "Knowledge Map buttons wrap without an internal scrollbar"
status: "confirmed"
tags: ["project-knowledge", "ui", "responsive-layout"]
created_at: "2026-08-11T06:44:28.048Z"
updated_at: "2026-08-11T06:44:28.048Z"
---

# Knowledge Map buttons wrap without an internal scrollbar

<!-- compiled_truth -->

The Manage Knowledge panel's Knowledge map root-page buttons wrap onto additional lines when sidebar width is constrained. The section must not use a horizontal scrollbar for these navigation controls.

## Timeline

- time: "2026-08-11T06:44:28.048Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-11T06:44:28.048Z"
  kind: "evidence"
  summary: "User request, 2026-08-11: \"In Manage knowledge page, the 'Knowledge Map' section has a scrollbar and should really wrap instead.\" Code change in packages/app/src/project-knowledge/panel.tsx."
