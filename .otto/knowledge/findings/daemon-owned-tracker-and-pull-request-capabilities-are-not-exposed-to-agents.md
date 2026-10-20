---
id: "daemon-owned-tracker-and-pull-request-capabilities-are-not-exposed-to-agents"
kind: "finding"
title: "Daemon-owned tracker and pull-request capabilities are not exposed to agents"
status: "proposed"
tags: ["kanban","git-hosting","jira","agent-tools","mcp","integrations"]
created_at: "2026-08-21T04:45:38.735Z"
updated_at: "2026-08-21T04:45:38.735Z"
---
# Daemon-owned tracker and pull-request capabilities are not exposed to agents

<!-- compiled_truth -->

Otto's daemon already implements issue-tracker and pull-request capabilities that agents cannot reach.

The Kanban subsystem lists boards, reads a board's full structure, creates cards, moves cards between columns, and links external work items, with a first-class Jira Cloud provider behind the provider-neutral SPI. The git-hosting layer creates, reads, lists, merges, and checks out pull requests, reads PR timelines, and searches issues and PRs across GitHub and Bitbucket Cloud. Both are authenticated, both are daemon-owned, and both re-check mutation preconditions daemon-side.

Neither reaches a model. The Otto tool catalog exposes no tool matching pull request, issue, kanban, board, or card. Every capability above is driven by client RPCs and is reachable only by a human clicking in the UI.

The consequence for agent-driven issue tracking (reading cards, commenting, transitioning, assigning) is that the blocker is not API knowledge and not authorization. Both are solved. The blocker is the absence of a tool surface over capabilities that already exist and are already authenticated.

This also resolves the authorization question for such a tool surface without new work. The Kanban provider config states the model explicitly: Kanban holds no credential store of its own and reuses whatever already authenticates the host to the same service, so a user who can already open pull requests can already see the board. A tool layer built on top inherits that. The model never sees a token, never sees a site origin, and cannot mint or alter an authorization through any argument it passes.

Unresolved: whether the right surface is Otto-native tools over the existing daemon services, or the vendor Atlassian remote MCP endpoint already in the connector catalog, or both for different halves. That comparison has not been made and is the natural next step.

## Timeline

- time: "2026-08-21T04:45:38.735Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["connectors","kanban-is-reached-via-host-project-pickers-the-board-target-is-configured-per","integration-authorization-is-daemon-owned-and-reusable"]
- time: "2026-08-21T04:45:38.735Z"
  kind: "evidence"
  summary: "Verified against the working tree on 2026-08-20 (branch main, at commit 2d0b9a764).\n\nMethod: read `packages/server/src/server/kanban/types.ts` for the provider SPI and its credential contract; read `packages/server/src/server/kanban/jira-provider.ts` for the Jira implementation; read `docs/git-providers.md` for the git-hosting service interface and capability matrix; then grepped the agent tool catalog at `packages/server/src/server/agent/tools/otto-tools.ts` for tool identifiers matching pull_request, kanban, jira, issue, hosting, board, or card.\n\nResult: zero matches in the tool catalog. The catalog's identifiers cover agents, workspaces, worktrees, terminals, artifacts, schedules, browser tools, previews, and project knowledge. No integration or tracker tool is present.\n\nKanban SPI confirmed present: listBoards, getBoard, moveCard, createCard, linkExternalTask, initialize, dispose.\n\nGit-hosting service interface confirmed present per docs/git-providers.md: listPullRequests, listIssues, getPullRequest, getPullRequestCheckoutTarget, getCurrentPullRequestStatus, getPullRequestTimeline, searchIssuesAndPrs, createPullRequest, mergePullRequest, enable/disablePullRequestAutoMerge, getGitHubCheckDetails, isAuthenticated.\n\nCredential-reuse contract quoted from `kanban/types.ts`: \"Kanban has no credential store of its own: it reuses whatever already authenticates the host to the same service, so a user who can already open PRs can already see the board.\""
