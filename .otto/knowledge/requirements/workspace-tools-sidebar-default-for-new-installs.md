---
id: "workspace-tools-sidebar-default-for-new-installs"
kind: "requirement"
title: "New installs show workspace tools in the sidebar"
status: "confirmed"
tags: ["workspace", "sidebar", "settings", "defaults"]
created_at: "2026-08-14T05:15:02.622Z"
updated_at: "2026-08-14T05:15:02.622Z"
---

# New installs show workspace tools in the sidebar

<!-- compiled_truth -->

Fresh installations default the developer-only workspace tools placement to the workspace list. Existing installations retain their persisted workspace-tools placement until the user changes it.

## Timeline

- time: "2026-08-14T05:15:02.622Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-14T05:15:02.622Z"
  kind: "evidence"
  summary: "User requirement, 2026-08-13. Implemented in packages/app/src/hooks/use-settings/storage.ts with regression coverage in storage.test.ts."
