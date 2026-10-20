---
id: "sidebar-workspace-tools-use-single-divider"
kind: "requirement"
title: "Workspace tools use a single divider"
status: "confirmed"
tags: ["ui", "sidebar", "workspace-tools", "divider", "design-system"]
created_at: "2026-08-12T22:41:03.932Z"
updated_at: "2026-08-12T22:41:03.932Z"
---

# Workspace tools use a single divider

<!-- compiled_truth -->

The left-sidebar active workspace tools bar owns its top separator, while the adjacent icon main menu owns the lower separator. The tools bar must not render its own bottom border, because doing so creates a doubled divider.

## Timeline

- time: "2026-08-12T22:41:03.932Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["sidebar-reveal"]
- time: "2026-08-12T22:41:03.932Z"
  kind: "evidence"
  summary: "User direction, 2026-08-12: the workspace tools bar on the left should not have a bottom line because the icon main menu already has one. Implemented in packages/app/src/components/sidebar/sidebar-active-workspace-tools.tsx by removing the container's borderBottomWidth and borderBottomColor."
