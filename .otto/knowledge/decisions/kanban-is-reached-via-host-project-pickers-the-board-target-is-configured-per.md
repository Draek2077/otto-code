---
id: "kanban-is-reached-via-host-project-pickers-the-board-target-is-configured-per"
kind: "decision"
title: "Kanban is reached via host + project pickers; the board target is configured per project in Project Settings"
status: "confirmed"
tags: ["kanban","github-projects-v2","jira","project-settings","access-model"]
created_at: "2026-08-17T04:17:29.825Z"
updated_at: "2026-08-22T15:37:18.127Z"
---
# Kanban is reached via host + project pickers; the board target is configured per project in Project Settings

<!-- compiled_truth -->

The Kanban surface is scoped to a project, not to a host or provider. The /kanban screen shows a host picker then a project picker for that host; the (host, project) pair determines which tracking board to display. On entry, it first resolves that pair from the active workspace or the last workspace the reader viewed when that host is Kanban-capable and the project is still available. A valid explicit Kanban selection remains authoritative; without usable workspace context, the screen follows its normal host/project fallback. Projects with no Kanban target configured show an empty watermark state with a link into that project's settings.

Kanban reuses the host's existing workspace/git-hosting authentication and has no token slots of its own:

- **GitHub (PRs and Projects v2/Kanban): the GitHub CLI owns auth.** There is no `gitHosting.providers.github.token` and none is added. The GitHub Kanban provider obtains its credential from `gh`; Settings' GitHub card reports `gh` auth status and the scopes Projects v2 needs (`read:project`, `project`, plus `repo` for private card content), with `gh auth refresh -s read:project,project` as the remedy when a scope is missing.
- **Jira and Bitbucket: Atlassian through the REST APIs, one credential set.** `gitHosting.providers` holds a single Atlassian credential (account email + API token, HTTP Basic) shared by the Bitbucket git-hosting service and the Jira Kanban provider, plus a non-secret Jira site URL because Basic-auth Jira Cloud calls are site-addressed.

Project-to-provider links are non-secret identifiers held per project in Project Settings. GitHub accepts a board number/URL, or derives boards from the repo remote when absent. Jira accepts a board id or URL. A GitHub board may be organization-scoped and shared by several projects, so no uniqueness constraint is imposed.

## Timeline

- time: "2026-08-17T04:17:29.825Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["kanban-board-platform-is-merged-but-the-github-path-is-unreachable-without-hand"]
- time: "2026-08-17T04:17:29.825Z"
  kind: "evidence"
  summary: "User decision in chat (2026-08). Current state: kanban.boards.list request carries only providerId (packages/protocol/src/kanban.ts:70), server KanbanBoardListContext {owner?, repo?} is unused on the wire (packages/server/src/server/kanban/types.ts), app screen hard-codes PROVIDER_OPTIONS = [\"memory\", \"github\"] (packages/app/src/screens/kanban-screen.tsx:44). Project model: ProjectDescriptor per host with projectKey grouping (packages/app/src/stores/session-store.ts:268, packages/app/src/utils/projects.ts); workspaces carry githubRuntime (repo owner/name). Project settings route: settings/projects/[serverId]/[projectId] → SettingsScreen view kind \"project\"."
- time: "2026-08-17T04:29:23.527Z"
  kind: "decision"
  summary: "User decision (chat): credentials belong in the two existing settings provider cards (GitHub + Atlassian), not separate kanban token slots and not in workspaces; the Atlassian card covers both Jira (kanban) and Bitbucket (git); required scopes should be listed in the UI. The project->provider link is a non-secret identifier in project settings, derivable from the repo where possible (GitHub) or an explicit board id (Jira)."
  affects: ["kanban-board-platform-is-merged-but-the-github-path-is-unreachable-without-hand","finding-2026-08-09-settings-ownership-and-visibility"]
- time: "2026-08-17T05:43:21.626Z"
  kind: "decision"
  summary: "The recorded credential model (\"Kanban providers read gitHosting.providers.{github, bitbucketCloud/atlassian}\") could not be implemented as literally written: the codebase has no GitHub token slot at all (the git-hosting GitHub service authenticates via the gh CLI's global config), and the only stored Atlassian credential is the Bitbucket Basic-auth email+apiToken pair with no Jira site URL. The prior build session stalled at this fork. The user resolved it by directive: GitHub PRs and GitHub Projects authenticate through the GitHub CLI, while Jira and Bitbucket are Atlassian over the REST APIs sharing one credential set. This records the resolution so the fork is not re-litigated."
  source: "User directive in chat, 2026-08-16, after reviewing the prior session's Phase 2 blocker. Code grounding: packages/server/src/services/git-hosting/resolver.ts:16"
  affects: ["kanban-board-platform-is-merged-but-the-github-path-is-unreachable-without-hand","github-atlassian-jira-token-scopes-required-for-the-kanban-providers"]
- time: "2026-08-22T15:37:18.127Z"
  kind: "decision"
  summary: "The user established that Kanban should open to the project context they were just viewing, not an arbitrary first project."
  source: "User direction in chat, 2026-08-22; implemented and unit-tested in packages/app/src/screens/kanban-screen.tsx."
