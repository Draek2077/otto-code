---
id: "workspace-change-indicator-is-app-local-developer-preference"
kind: "architecture"
title: "Workspace change indicator is an app-local developer preference"
status: "confirmed"
tags: ["workspace", "git", "ui", "settings"]
created_at: "2026-08-11T04:09:59.450Z"
updated_at: "2026-08-11T04:21:14.369Z"
---

# Workspace change indicator is an app-local developer preference

<!-- compiled_truth -->

The workspace +/- indicator mode is a developer-only app-local preference, rendered in Appearance > Layout. It controls sidebar presentation across the client and is not host or daemon configuration, so it must not be placed in Host Settings.

## Timeline

- time: "2026-08-11T04:09:59.450Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-11T04:09:59.450Z"
  kind: "evidence"
  summary: "User clarification on 2026-08-10 after reviewing the proposed Host Settings placement."
- time: "2026-08-11T04:21:14.369Z"
  kind: "evidence"
  summary: "The main sidebar project/workspace path (`sidebar-workspace-list.tsx`) never passes a diff stat into its workspace-row trailing controls. Its project header instead calls `useSidebarProjectDiffStat`, whose selector always sums `WorkspaceDescriptor.diffStat` (branch-versus-base) and ignores `workspaceChangeIndicator`, including `hidden`. A separate `sidebar-workspace-row.tsx` does honor the preference, but is not the main project/workspace row implementation."
  source: "Implementation audit, 2026-08-10"
