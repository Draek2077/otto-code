---
id: "workspace-tab-gutter-prioritizes-new-surface-actions"
kind: "requirement"
title: "Workspace tab gutter prioritizes new-surface actions"
status: "confirmed"
tags: ["workspace","tabs","preview","interaction-design"]
created_at: "2026-09-02T13:03:09.859Z"
updated_at: "2026-09-02T13:03:09.859Z"
---
# Workspace tab gutter prioritizes new-surface actions

<!-- compiled_truth -->

The workspace tab gutter pins **New chat**, **New terminal**, and **New browser** as its primary creation actions when each capability is available. Preview server management, artifacts, pane splitting, and terminal-profile actions remain in the More actions menu. Selecting Preview from that menu must still surface its configured-server picker through a non-layout-affecting anchor in the gutter.

## Timeline

- time: "2026-09-02T13:03:09.859Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-09-02T13:03:09.859Z"
  kind: "evidence"
  summary: "User requirement in this chat on 2026-09-02; implemented and typechecked in packages/app/src/screens/workspace/workspace-desktop-tabs-row.tsx."
