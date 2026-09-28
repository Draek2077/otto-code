---
id: "finding-2026-09-27-kanban-github-graphql-invalid"
kind: "finding"
title: "Every GitHub Projects v2 GraphQL document in the Kanban provider was invalid, and mocked tests could not see it"
status: "proposed"
tags: ["kanban","github-projects-v2","graphql","testing","v0.9"]
created_at: "2026-09-27T23:55:36.910Z"
updated_at: "2026-09-27T23:55:36.910Z"
---
# Every GitHub Projects v2 GraphQL document in the Kanban provider was invalid, and mocked tests could not see it

<!-- compiled_truth -->

## What was observed

Opening a project-configured GitHub Projects board returned, from the daemon:

- `Selections can't be made directly on unions (see selections on ProjectV2FieldConfiguration)` (twice)
- `No such type ProjectV2FieldSingleSelect, so it can't be a fragment condition`

These are GraphQL **document validation** errors, not execution errors. GitHub rejected the board query before reading any data, so the board read could never have succeeded on any account, board, or credential.

Investigation found the same class of defect in every other document in `packages/server/src/server/kanban/github-provider.ts`. The module had been written against an imagined schema.

## Verified defects

Confirmed by live introspection of `api.github.com/graphql` on 2026-09-27.

1. **`ProjectV2FieldSingleSelect` does not exist.** The type is `ProjectV2SingleSelectField`.
2. **`ProjectV2FieldConfiguration` is a union** of `ProjectV2Field`, `ProjectV2IterationField`, `ProjectV2MultiSelectField`, `ProjectV2SingleSelectField`. A union carries no fields, so `id` and `name` must be read through the `ProjectV2FieldCommon` interface and can never be selected directly.
3. **`ProjectV2SingleSelectField.options` is a plain list**, not a Relay connection: `options { id name }`, no `first:` argument and no `nodes` wrapper.
4. **`__typename` is returned only when selected.** No document requested it, yet every narrowing in the module read it. Even with the fragment names fixed, every board would have reported "Board not found" and every item would have been skipped.
5. **`addProjectV2ItemToProject` does not exist**, and took no `contentKind`/`title`/`body`. Drafts use `addProjectV2DraftIssue` (payload field `projectItem`); existing issues and PRs use `addProjectV2ItemById` (payload field `item`). Both create and link were inert.
6. **A null `singleSelectOptionId` cannot express "clear".** `ProjectV2FieldValue` rejects an input with no value set, so dropping a card on the synthetic Unassigned column needed `clearProjectV2ItemFieldValue`.
7. **`DraftIssue` was absent from the content union.** The item content union is `DraftIssue | Issue | PullRequest`, so a board whose cards are drafts read as entirely empty. `DraftIssue` has no `url`.
8. **Card status bound to the first single-select value**, not to the status field. A board with both Status and Priority placed cards by whichever value arrived first; `ProjectV2ItemFieldSingleSelectValue.field` is itself the field union, so the owning id comes through `ProjectV2FieldCommon`.
9. **`ignoreNotFoundAt` only matched `path[0]`.** GitHub reports the unmatched half of the issue/PR resolve query at `["repository","issue"]`, so linking by number always threw.
10. **The status-field cache was deleted after every mutation**, so a second consecutive card move threw "Board layout not cached" until a board refresh landed in between.
11. **No pagination.** One fixed page of 200 items, 20 fields and 50 options was served as a whole board.

## Why the tests did not catch it

`github-provider.test.ts` stubbed `fetch` and asserted against fixtures that encoded the same imagined schema (`__typename: "ProjectV2FieldSingleSelect"`, `options: { nodes: [...] }`). The suite was green while every request the provider sent was rejected. A response fixture that does not match the vendor schema tests nothing at all.

This is the concrete cost of the charter's own warning that fixtures never substitute for provider proof: the charter's "Verified current baseline" asserted that the provider "reads GraphQL fields/items and mutates item status/create/link" on the strength of source inspection plus these fixtures, and that claim was false.

## What guards it now

- Every document is validated against the live schema by executing it with non-resolving dummy variables: a schema mismatch surfaces as a validation error (no `type`, no `path`), while a correct document reaches execution and answers `NOT_FOUND`. All 13 documents now reach execution.
- Fixtures were recaptured from the real response shapes.
- A `describe("the documents GitHub actually accepts")` block asserts the type names, the interface indirection, the plain-list options, the `__typename` selections, and the mutation names directly against the documents the provider emits, since that is the one thing a stubbed `fetch` can verify about them.

## Still unproven

No live read, move, or create has been run against a real GitHub Projects board. Document validity is proven; end-to-end provider acceptance is not.

## Timeline

- time: "2026-09-27T23:55:36.910Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["kanban","github-atlassian-jira-token-scopes-required-for-the-kanban-providers","e2e-qa-coverage"]
- time: "2026-09-27T23:55:36.910Z"
  kind: "evidence"
  summary: "Live introspection of api.github.com/graphql on 2026-09-27 (gh CLI credential, `project` scope): `ProjectV2FieldConfiguration` kind=UNION with possibleTypes ProjectV2Field, ProjectV2IterationField, ProjectV2MultiSelectField, ProjectV2SingleSelectField; `ProjectV2FieldCommon` kind=INTERFACE exposing id and name; `ProjectV2SingleSelectField.options` typed NON_NULL LIST; `ProjectV2ItemContent` possibleTypes DraftIssue, Issue, PullRequest; `DraftIssue` fields carry no url; Mutation exposes addProjectV2DraftIssue, addProjectV2ItemById, clearProjectV2ItemFieldValue, updateProjectV2ItemFieldValue and no addProjectV2ItemToProject; AddProjectV2ItemByIdInput inputFields are clientMutationId, projectId, contentId only.\n\nNested NOT_FOUND path shape confirmed live against cli/cli#1: data returned pullRequest plus an error at path [\"repository\",\"issue\"].\n\nDocument validation harness (.tmp/validate-kanban-graphql.mjs, throwaway): 13 of 13 documents reach execution, 0 invalid.\n\nFocused tests after the rewrite: packages/server/src/server/kanban 5 files, 67 tests passed; packages/protocol/src/kanban.test.ts 13 tests passed. npm run build:client, protocol typecheck, server typecheck, app typecheck, targeted lint and oxfmt all passed.\n\nNot run: any live GitHub Projects board read, move, or create."
