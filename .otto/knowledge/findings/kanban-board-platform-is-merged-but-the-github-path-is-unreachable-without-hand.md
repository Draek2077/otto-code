---
id: "kanban-board-platform-is-merged-but-the-github-path-is-unreachable-without-hand"
kind: "finding"
title: "Kanban board platform is merged but the GitHub path is unreachable without hand-editing daemon config"
status: "proposed"
tags: ["kanban", "github-projects-v2", "feature-gap", "settings"]
created_at: "2026-08-17T04:04:53.212Z"
updated_at: "2026-08-17T04:04:53.212Z"
---

# Kanban board platform is merged but the GitHub path is unreachable without hand-editing daemon config

<!-- compiled_truth -->

The provider-agnostic Kanban board platform (commit 02dcb7387) is fully merged: protocol RPCs kanban.boards.list/board.get/card.move/card.create/task.link, a KanbanProvider SPI with memory, github (Projects v2 over GraphQL), and jira providers, and an app screen at /kanban reachable from a left-sidebar "Kanban" row (not the project menu). Three gaps: (1) no settings UI exists for the kanban.providers.github.token — the provider's error message references a nonexistent "Kanban settings", and unconfigured GitHub tokens are silently swallowed into an empty board list, so GitHub boards never appear unless the token is hand-edited into daemon config; (2) the app hard-codes PROVIDER_OPTIONS = ["memory", "github"], so the built Jira provider is unreachable from the UI; (3) kanban.task.link has full wire/session/client plumbing but no app caller (the card link icon just opens card.url).

## Timeline

- time: "2026-08-17T04:04:53.212Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-17T04:04:53.212Z"
  kind: "evidence"
  summary: "packages/app/src/screens/kanban-screen.tsx:44 (PROVIDER_OPTIONS), :165-170 (error swallowed to empty list); packages/server/src/server/kanban/github-provider.ts:401 (\"add a personal access token in the Kanban settings\"); grep of packages/app/src/screens/settings for \"kanban\" returns no matches; packages/server/src/server/daemon-config-store.ts:107-108 (token in SECRET_WIRE_PATHS); packages/server/src/server/kanban/kanban-registry.ts (memory/github/jira registered)."
