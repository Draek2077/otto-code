---
id: "consistent-tab-context-menu-sections"
kind: "requirement"
title: "Consistent tab context-menu sections"
status: "confirmed"
tags: ["ui", "workspace-tabs", "context-menu"]
created_at: "2026-08-09T18:49:12.032Z"
updated_at: "2026-08-09T18:49:12.032Z"
---

# Consistent tab context-menu sections

<!-- compiled_truth -->

All tab context menus use the same section order: workspace actions first, tab-specific actions such as reload and rename next, the three bulk-close actions next, and the single-tab Close action last, with separators between populated sections.

## Timeline

- time: "2026-08-09T18:49:12.032Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-09T18:49:12.032Z"
  kind: "evidence"
  summary: "User requirement stated on 2026-08-09; implemented in packages/app/src/screens/workspace/workspace-tab-menu.ts and covered by workspace-tab-menu.test.ts."
