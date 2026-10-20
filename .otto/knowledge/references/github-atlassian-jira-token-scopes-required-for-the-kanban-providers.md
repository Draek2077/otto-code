---
id: "github-atlassian-jira-token-scopes-required-for-the-kanban-providers"
kind: "reference"
title: "GitHub + Atlassian (Jira) token scopes required for the Kanban providers"
status: "confirmed"
tags: ["kanban", "github-projects-v2", "jira", "atlassian", "token-scopes", "settings"]
reference_disposition: "adopted"
source_url: "https://developer.atlassian.com/cloud/jira/software/jira-software-rest-api-scopes/"
created_at: "2026-08-17T04:31:07.312Z"
updated_at: "2026-08-17T04:31:07.312Z"
---

# GitHub + Atlassian (Jira) token scopes required for the Kanban providers

<!-- compiled_truth -->

Verified scope requirements for the two Kanban provider credential slots (GitHub + Atlassian/Jira). These are the scopes the settings cards should list so a user can create a working token.

**GitHub (classic PAT — fine-grained PATs do NOT support the GraphQL API, and Projects v2 field writes are GraphQL-only):**

- `read:project` — list/read Projects v2 boards and items (`projectsV2`, `KanbanBoard` reads).
- `project` — write: move cards (`updateProjectV2ItemFieldValue`), add items (`addProjectV2ItemToProject`).
- `repo` (or `public_repo` for public-only) — read Issue/PR card content from private repos.
- Note: `createProjectV2` with a `repositoryId` additionally needs Contents permission on that repo (GitHub App case); not needed for our read/move/create-card flows.

**Atlassian / Jira Cloud (scoped API token; an unscoped token also works but is broader):**

- `read:jira-work` — read issues, boards, backlogs, quick filters, JQL search.
- `write:jira-work` — create/update issues, move issues (addIssue/removeIssue on quick filters).
- `read:board-scope:jira-software` — board operations (list boards, board config).
- `read:project:jira` — read Jira project details.
- (Minimum set for our provider. An unscoped token is the low-friction alternative if the user prefers.)

Sources: GitHub Projects v2 API docs + multiple corroborating reports that `projectsV2` needs `read:project`/`project` and that fine-grained tokens are unsupported for GraphQL; Atlassian Jira scoped-token scope list (scope naming `read:jira-work`, `write:jira-work`, `read:board-scope:jira-software`).

## Timeline

- time: "2026-08-17T04:31:07.312Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["kanban-is-reached-via-host-project-pickers-the-board-target-is-configured-per"]
- time: "2026-08-17T04:31:07.312Z"
  kind: "evidence"
  summary: "Web research 2026-08: GitHub docs \"Using the API to manage Projects\" (createProjectV2 repo Contents note); SO #72781886 (projectsV2 needs read:project, fine-grained unsupported for GraphQL); Atlassian Jira Software REST API scopes page + scoped-token scope list (read:jira-work / write:jira-work / read:board-scope:jira-software / read:project:jira)."
