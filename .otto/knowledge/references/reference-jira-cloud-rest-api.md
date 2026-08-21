---
id: "reference-jira-cloud-rest-api"
kind: "reference"
title: "Jira Cloud REST API v3"
status: "proposed"
tags: ["jira","atlassian","rest-api","adf","kanban","integrations"]
reference_disposition: "adopted"
source_url: "https://developer.atlassian.com/cloud/jira/platform/rest/v3/"
created_at: "2026-08-21T04:46:15.308Z"
updated_at: "2026-08-21T04:46:15.308Z"
---
# Jira Cloud REST API v3

<!-- compiled_truth -->

Jira Cloud's platform REST API, the surface behind agent-facing issue-tracker work: reading cards, commenting, transitioning, assigning, creating, and attaching. Otto's Kanban Jira provider already builds on it. This page records the behaviors that are not obvious from the reference docs and that cost time to rediscover.

## Addressing

Two addressable forms exist and they are not interchangeable.

- The user's own site origin, `https://<site>.atlassian.net/rest/api/3/...`. Otto's Kanban provider uses this.
- The gateway, `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/...`, which requires resolving a cloud id first.

Otto's `jira-provider.ts` carries a comment asserting the gateway is OAuth-only, and chose the site origin to avoid the cloud-id lookup. An audited corpus of operator scripts contradicts this: 26 of them reach the gateway with account email plus API token over HTTP Basic, which is the same credential Otto already holds. **This contradiction is unresolved and worth settling directly**, because if the gateway does accept Basic then the addressing choice, and the need for a site-origin setting at all, is reopened. Do not treat either claim as settled without a live check.

Board and sprint operations live on a separate prefix, `/rest/agile/1.0`, while issues live on `/rest/api/3`. Otto's provider already splits these correctly.

## Search moved

Issue search is `POST /rest/api/3/search/jql`, not `/rest/api/3/search`. The audited corpus uses the new path in twelve places, so this is settled rather than experimental.

## Transitions are discovered, never named

A workflow state cannot be set by name or by writing the status field. The sequence is `GET /rest/api/3/issue/{key}/transitions` to obtain the transitions legal from the issue's current status, then `POST` to the same path with a transition id.

Workflows also gate multi-step paths: reaching a target state can require passing through intermediate states, so a single logical move can be several transitions. The audited corpus handles this by hardcoding an ordered sequence of ids, which is tenant-specific and does not generalize.

The consequence for a tool surface is that transitioning must be two-phase, with the agent reading the legal moves before choosing one. That is a desirable property rather than a cost, because it makes each workflow self-describing to the model without any per-tenant configuration.

## Bodies are ADF, not Markdown

Issue descriptions and comments are Atlassian Document Format, a nested JSON node tree (`{"type": "doc", "version": 1, "content": [...]}`). Plain strings are rejected.

The audited corpus implements Markdown to ADF **three separate times**, and only the most developed of the three handles lists and tables. That triplication is the signal worth carrying: any Jira write path needs exactly one converter, it must cover inline marks, links, code, lists, and tables, and it is the single largest piece of work in a Jira integration. Underestimating it is the standard mistake.

## Custom field ids are per-tenant and must be resolved by name

Story points, team, sprint, and epic link are all custom fields whose numeric ids differ per tenant. Hardcoding them produces an integration that works on exactly one site.

`GET /rest/api/3/field` returns the full name-to-id map. Fetch once, cache for the process, and resolve by name. Story points needs a fallback chain, because classic projects and next-generation projects name the field differently ("Story Points" versus "Story point estimate") and a tenant can have both, in which case the classic field is the populated one.

Of the audited scripts, 25 hardcoded ids and one resolved by name. The corpus contained its own fix for its worst portability defect.

## The tracker-to-code bridge

`GET /rest/dev-status/1.0/issue/detail?issueId={id}&applicationType={provider}&dataType=branch` returns the branches and pull requests a git host integration has linked to an issue. This is the least discoverable endpoint in the set and the most interesting one for Otto, because it answers "what branch is this card being worked on in" with no local git state and no branch-name convention.

## Rate limits

429 responses carry `Retry-After`. The audited corpus honors the header when present and falls back to exponential backoff, then surfaces a retry count in its output so throttling is visible rather than silent. Otto's git-hosting layer already implements a stricter version of this (one retry, GET only, hard cap, cooldown with cache fallback), and that discipline should extend to any Jira client.

## Capability coverage against agent-facing tracker work

| Capability | Endpoint |
| --- | --- |
| Search cards | `POST /rest/api/3/search/jql` |
| Read one card deeply | `GET /rest/api/3/issue/{key}` plus `/comment` and `/changelog` |
| Comment | `POST /rest/api/3/issue/{key}/comment` |
| Change state | `GET` then `POST /rest/api/3/issue/{key}/transitions` |
| Create and update | `POST` and `PUT /rest/api/3/issue` |
| Attach files | `POST /rest/api/3/issue/{key}/attachments` |
| Link issues | `POST /rest/api/3/issueLink` |
| Resolve field ids | `GET /rest/api/3/field` |
| Linked branches and PRs | `GET /rest/dev-status/1.0/issue/detail` |

Assignment is the one capability on the agent-facing list that the audited corpus never exercised, so it carries no hard-won knowledge here and remains unverified.

## Timeline

- time: "2026-08-21T04:46:15.308Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["daemon-owned-tracker-and-pull-request-capabilities-are-not-exposed-to-agents","kanban-is-reached-via-host-project-pickers-the-board-target-is-configured-per","github-atlassian-jira-token-scopes-required-for-the-kanban-providers"]
- time: "2026-08-21T04:46:15.308Z"
  kind: "evidence"
  summary: "Audit of a corpus of 41 operator scripts covering Jira, Confluence, and Bitbucket Cloud, performed 2026-08-20. 16 of the scripts target Jira. Endpoint inventory extracted by pattern-matching request paths across the corpus and counting occurrences; field-id and constant inventory extracted by pattern-matching custom field references and module-level constants.\n\nCounts recorded at audit time: `/rest/api/3/search/jql` appears 12 times; `https://api.atlassian.com/ex/jira/{cloudId}` appears in 26 files; markdown-to-ADF conversion is implemented 3 times independently; custom field ids are hardcoded in 25 files and resolved by name in 1.\n\nThe gateway-versus-site-origin contradiction is between the corpus (gateway plus HTTP Basic, working) and the comment at `packages/server/src/server/kanban/jira-provider.ts` (gateway described as OAuth-only). Neither was tested live during this audit. Recorded as unresolved.\n\nScope requirements for these operations are recorded separately in the Kanban token-scopes reference page and are not restated here.\n\nSource-specific values (tenant identifier, site origin, custom field numbers, transition ids, board ids) were deliberately excluded from this page: they are evidence, not knowledge, and none generalize."
