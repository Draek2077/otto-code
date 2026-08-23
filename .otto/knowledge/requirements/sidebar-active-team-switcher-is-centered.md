---
id: "sidebar-active-team-switcher-is-centered"
kind: "requirement"
title: "Sidebar Active Team switcher is centered"
status: "confirmed"
tags: ["ui","sidebar","agent-teams","layout"]
created_at: "2026-08-21T15:31:32.496Z"
updated_at: "2026-08-22T18:23:37.173Z"
---
# Sidebar Active Team switcher is centered

<!-- compiled_truth -->

When the Active Team switcher is placed in the left sidebar, its full-width trigger and touch target remain full width. Its icon-and-label content is left-aligned in both the two-column sidebar-navigation layout and the compact one-column layout, matching History and the navigation rows. The title-bar placement keeps its existing alignment.

## Timeline

- time: "2026-08-21T15:31:32.496Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T15:31:32.496Z"
  kind: "evidence"
  summary: "User requirement, 2026-08-21: “the team browser can be centered as well inside its space when its on the left sidebar.” Implemented for both the grouped multi-host and per-host Active Team switcher triggers."
- time: "2026-08-21T15:34:01.187Z"
  kind: "decision"
  summary: "User clarified that the left-sidebar switcher must return to left alignment when the shared sidebar navigation collapses to one column."
  source: "User requirement, 2026-08-21"
- time: "2026-08-21T15:36:40.956Z"
  kind: "decision"
  summary: "User clarified that centered content must retain the full-width sidebar trigger and touch target."
  source: "User requirement, 2026-08-21"
- time: "2026-08-22T18:23:37.173Z"
  kind: "decision"
  summary: "User requirement, 2026-08-22: restore left alignment for the Team picker in both compact and wide sidebar layouts."
  source: "User requirement, 2026-08-22"
