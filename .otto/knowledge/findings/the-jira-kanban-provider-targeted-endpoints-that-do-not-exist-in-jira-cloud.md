---
id: "the-jira-kanban-provider-targeted-endpoints-that-do-not-exist-in-jira-cloud"
kind: "finding"
title: "The Jira Kanban provider targeted endpoints that do not exist in Jira Cloud"
status: "proposed"
tags: []
created_at: "2026-08-17T05:53:06.292Z"
updated_at: "2026-08-17T05:53:06.292Z"
---

# The Jira Kanban provider targeted endpoints that do not exist in Jira Cloud

<!-- compiled_truth -->

The merged Jira Kanban provider could never have worked against a real Jira Cloud site, independently of credentials. Two separate faults:

1. **Wrong API surface.** Every call went to `https://api.atlassian.com/ex/jira` + `/api/3/...`. The `api.atlassian.com/ex/jira` gateway is OAuth-only and requires a `cloudId` path segment (`/ex/jira/{cloudId}/rest/api/3/...`) that was never supplied, and `/api/3/board` is not a path in any Jira API. Jira Cloud boards live under `/rest/agile/1.0/board`, issues under `/rest/api/3/issue`, and Basic-auth calls are site-addressed (`https://<site>.atlassian.net/rest/...`).

2. **Columns modelled as quick filters.** Columns were mapped to board Quick Filters, and a card "move" was `POST /rest/.../quickfilter/{id}/addIssue` / `removeIssue`. Those endpoints do not exist: quick filters are saved JQL searches with no writable membership. Reading a board also cost one search per filter (N+1 per board read).

Corrected: columns now come from the board's real column configuration (`GET /rest/agile/1.0/board/{id}/configuration` -> `columnConfig.columns[]`, each owning a set of status ids), a card's column is decided by the issue's own status (so a board read is 4 requests regardless of column count), and a move is an ordinary workflow transition (`GET`/`POST /rest/api/3/issue/{key}/transitions` into a status the target column owns). Statuses that map to no column keep their issues in a synthetic read-only "Unassigned" column, because Jira allows them and hiding them would lose work the user can see in Jira. Bodies round-trip through Atlassian Document Format, which the v3 platform API requires and the old code passed as a raw string.

Not yet addressed: a Jira workflow can legitimately forbid a transition, so a column the user can see is not always one they can drag into. That now surfaces as an explicit error rather than a silent no-op, but the board does not yet grey out unreachable columns during a drag.</statement>
<parameter name="evidence">Found while re-pointing the Jira provider at the shared Atlassian credential (2026-08-16). Original code: packages/server/src/server/kanban/jira-provider.ts:8 (DEFAULT_API_BASE_URL = "https://api.atlassian.com/ex/jira"), :86/:93/:104 (`/api/3/board`, `/api/3/board/{id}/filter`), :170/:182 (`/api/3/quickfilter/{id}/removeIssue` and `/addIssue`), :288 (`/api/3/board/{id}/quickfilter/{id}/search`), :297 (Bearer auth). The old test suite passed only because its fetch stub answered those invented paths (packages/server/src/server/kanban/jira-provider.test.ts:59 routed "/ex/jira/api/3/board") - the stub encoded the same wrong API as the implementation, so no test could have caught it. Rewritten provider + 15 tests over the real REST surface: 27/27 kanban server tests pass; @otto-code/server typecheck clean.</evidence>
<parameter name="tags">["kanban","jira","atlassian","provider-correctness","test-fixture-blindspot"]

## Timeline

- time: "2026-08-17T05:53:06.292Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["kanban-is-reached-via-host-project-pickers-the-board-target-is-configured-per","kanban-board-platform-is-merged-but-the-github-path-is-unreachable-without-hand"]
