---
id: "session-import-browses-all-projects-and-imports-selections"
kind: "requirement"
title: "Session import browses all projects and imports selections"
status: "proposed"
tags: ["import-session","workspace","codex","ui"]
created_at: "2026-09-12T13:12:37.413Z"
updated_at: "2026-09-12T13:12:37.413Z"
---
# Session import browses all projects and imports selections

<!-- compiled_truth -->

The Import session picker can show native provider sessions across projects on the selected host through an explicit Show chats from all projects checkbox. It defaults to the current workspace; the home-screen entry already browses across working folders. Rows support selection, Select all shown, and Import selected with sequential progress and per-session failure recovery. Changing scope or provider clears selection. Imports retain the provider's existing session storage and working folder; a foreign working folder receives its own Otto workspace, while same-workspace imports retain the requesting workspace. This supports the user-driven ChatGPT chat to Codex Desktop to Otto path once the chat exists as a local Codex session; it does not directly import ChatGPT exports.

## Timeline

- time: "2026-09-12T13:12:37.413Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-09-12T13:12:37.413Z"
  kind: "evidence"
  summary: "User requested showing chats outside the current project and importing a selection on 2026-09-12, then clarified that Codex's own storage location is acceptable and that the desired chain is ChatGPT chats -> Codex Desktop -> Otto. Live read-only discovery earlier in this conversation found Review test response (01a095a0-0a41-7852-b9c9-0aed109b3642) in Codex and showed it appears without a cwd filter but not under the otto-code cwd. Implemented in import-session-sheet.tsx, import-session-checkbox.tsx, use-import-session-batch.ts, and the workspace-screen import handoff. Documented in docs/providers.md. The focused import-session-sheet.test.tsx suite passed all 21 tests; app typecheck and targeted lint passed. Actual native import/rendered acceptance remains with the user's planned dev-app test. Repository module-size check has pre-existing failures in unchanged files."
