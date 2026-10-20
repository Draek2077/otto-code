---
id: "kanban-credential-failures-offer-a-copy-or-run-in-terminal-fix"
kind: "requirement"
title: "Kanban credential failures offer a copy or run-in-terminal fix"
status: "proposed"
tags: ["kanban","github-projects-v2","token-scopes","remediation","gh-cli"]
created_at: "2026-08-20T06:16:48.113Z"
updated_at: "2026-08-20T06:25:55.587Z"
---
# Kanban credential failures offer a copy or run-in-terminal fix

<!-- compiled_truth -->

When a Kanban provider call fails for a credential reason Otto knows how to fix, the daemon replaces the provider's own error guidance with a resolved recovery route and the board screen offers it directly: the exact command, Copy as the primary action, and Run in terminal as a secondary action behind a confirm dialog showing the literal text. Same contract as the LSP install block: the daemon resolves the command as argv, the client only displays, copies, or runs it on explicit consent, and nothing is spawned while the user's back is turned.

Running it does not stop at spawning. The recovery command is a device-flow sign-in, so a terminal the user cannot see is no better than no terminal at all: Otto opens the created terminal's workspace with that terminal focused, via the shipped `?open=terminal:<id>` deep-link intent, putting the user at the prompt to read the one-time code and press Enter. Only when the daemon could not bind the terminal to a workspace does it fall back to a notice. This is why the real terminal is reused instead of embedding a second terminal surface on the Kanban screen.

The first case is GitHub Projects v2 scope failures. Otto's GitHub credential is the gh CLI's OAuth token, not a personal access token, so GitHub's own error text ("modify your token's scopes at https://github.com/settings/tokens") is a dead end: the gh grant is not listed on that page, and the fine-grained token page has no read:project equivalent at all. The daemon detects the INSUFFICIENT_SCOPES shape, names the missing scopes, and hands over `gh auth refresh -s read:project,project` (with `-h <host>` for a GitHub Enterprise base URL).

A remediable failure also invalidates the session's cached provider initialization. `gh auth refresh` mints a new token, so a session that keeps its pre-refresh credential can never recover; dropping the initialization makes the next request re-read the credential and the user's retry actually work.

The wire carries this as an optional `remediation` on every Kanban response payload: an opaque `reason` key, the missing scopes, resolved argv steps, and a documentation URL. It is provider-neutral by construction, so Jira credential failures can use the same channel.

## Timeline

- time: "2026-08-20T06:16:48.113Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["github-atlassian-jira-token-scopes-required-for-the-kanban-providers","kanban-is-reached-via-host-project-pickers-the-board-target-is-configured-per","missing-lsp-servers-offer-copy-or-run-in-terminal-install-commands"]
- time: "2026-08-20T06:16:48.113Z"
  kind: "evidence"
  summary: "Reported 2026-08-19 by the user: Projects v2 boards failed with three repeated \"your token has not been granted the required scopes\" errors (granted: gist, read:org, repo, workflow), and the GitHub token page GitHub linked to offered no \"projects\" option. That scope set is the stock `gh auth login` grant, which is what packages/server/src/server/kanban/github-cli-token.ts reads.\n\nImplemented 2026-08-20. Server: `describeScopeFailure` in kanban/github-provider.ts parses the required scopes from the message and the granted set from the `x-oauth-scopes` response header (falling back to the message text), then throws `KanbanRemediationError` (kanban/kanban-remediation.ts). `KanbanSession.failure()` forwards the remediation and deletes the provider from `initializedProviders`. Protocol: `KanbanRemediationSchema` in packages/protocol/src/kanban.ts, optional on all five response payloads (COMPAT(kanbanRemediation), added in v0.8.12); the payload objects are not `.strict()`, so old clients ignore it. Client: `KanbanRemediationBlock` (packages/app/src/screens/kanban-remediation-block.tsx) renders under both board-error states; the terminal opens in the project's repoRoot on the failing host and the daemon resolves the workspace binding from that cwd.\n\nTests: github-provider.test.ts pins the detection against GitHub's verbatim three-error response (missing scopes, argv, the PAT link not surviving), the header-vs-message granted-scope sources, the GitHub Enterprise `-h` flag, and an unrelated GraphQL error staying a plain Error. kanban-session.test.ts pins the wire forwarding, the re-initialization on retry, and that a non-remediable failure keeps the cached initialization.\n\nNot verified end to end against a live underscoped gh credential; the detection is pinned to GitHub's real error text rather than a live call.\n\nKnown gap: the created terminal is a normal terminal tab in the project's workspace, so the user has to open that workspace to read the one-time code and press Enter. An embedded terminal on the Kanban screen (the `presentation: \"embedded\"` route the external file editor uses) would close that gap."
- time: "2026-08-20T06:25:47.123Z"
  kind: "decision"
  summary: "The user rejected the toast-only handoff: \"Imo we either switch to project workspace or we do terminal embedded.\" Run in terminal now navigates to the project's workspace with the new terminal focused, using the shipped `?open=terminal:<id>` intent, rather than leaving the user to find the terminal."
  source: "Chat 2026-08-20"
- time: "2026-08-20T06:25:55.587Z"
  kind: "evidence"
  summary: "Navigation implemented 2026-08-20 in packages/app/src/screens/kanban-remediation-outcome.ts: `resolveRemediationTerminalOutcome` maps the create_terminal response to navigate / started / error. `create_terminal_response` carries `terminal.workspaceId` (the daemon resolves it from the cwd in terminal-session-controller.ts), so the route needs no workspace lookup on the client. The `?open=terminal:<id>` intent is parsed in packages/app/src/app/h/[serverId]/workspace/[workspaceId]/index.tsx and was already shipped for notification routing. kanban-remediation-outcome.test.ts pins the route, the no-workspace fallback, and the error case.\n\nThe embedded-terminal alternative (TerminalPane with `presentation: \"embedded\"`, as external-file-editor-pane.tsx uses) was not taken: it would build a second terminal surface, with its own focus, sizing, and keyboard handling, on a screen that has no pane infrastructure, to reach a prompt the real terminal already provides."
  source: "Chat 2026-08-20"
