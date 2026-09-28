# Kanban

Kanban shows an external board for one host and project at a time. The project record selects a GitHub Projects v2 or Jira Cloud board in Project Settings. The daemon owns credentials, provider calls, and the board mapping; the app selects a host, project, and one of that project's available boards. A project without a configured target shows a setup action instead of guessing a board.

## Provider boundary

The common board model has columns and cards with opaque IDs. A card contains its title, description, URL when one exists, status, and assignees. Editable field definitions and each card's field values travel beside the board in the `kanban.board.get.response` payload. They cannot be added to `KanbanCard`: its wire schema is strict, and an older client would reject the entire board response. Field kinds are open strings; an unknown kind displays its provider-supplied text without an editor.

| Operation                     | GitHub Projects v2                                                                           | Jira Cloud                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Read                          | Project fields and items, including draft issues, issues, and pull requests                  | Board configuration and its paged issues                          |
| Create                        | Draft project item                                                                           | Issue in the board's project                                      |
| Link                          | Existing issue or pull request; accepts a node ID, repository number, or GitHub issue/PR URL | Existing issue key, if the board filter includes it               |
| Move                          | Set or clear the project's Status field                                                      | Use an available issue workflow transition into a column's status |
| Edit                          | Title, description, assignees, labels, and supported project custom fields                   | Fields exposed as editable by each issue's `editmeta`             |
| Remove from board             | Deletes the project item; a linked repository issue or PR remains there                      | Unavailable                                                       |
| Refresh after outside changes | Polls a board revision marker every 30 seconds and forces a re-read within five minutes      | Manual refresh                                                    |

GitHub columns come from the single-select field named Status or State. Another single-select field, such as Priority, is a card field rather than a column. Project custom fields, including any team-defined priority or due date, are handled by their reported type. GitHub field and option reads refuse to return a partial board when a provider connection exceeds Otto's current read limits: 2,000 items, 500 fields, 100 field values or assignees or labels on a card, 20 linked repositories, or 100 assignable users or labels in one repository.

Jira columns come from the board configuration, and issue statuses determine placement. An issue with no matching column appears under Unassigned. A visible target column is not necessarily an allowed transition for a particular issue; the provider reports that failure. Jira field editing uses that issue's `GET /rest/api/3/issue/{key}/editmeta` result for field visibility, allowed choices, and set permission, then rechecks it before a write. Description and textarea fields use Atlassian Document Format. Unsupported or unavailable fields appear as read-only or are omitted. This follows Jira's [issue edit metadata and edit issue API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/).

GitHub auth uses the host's `gh` CLI credential with `read:project` and `project` scopes. Jira uses the shared Atlassian account credential plus its site URL. Provider failures are returned as errors; GitHub missing-scope failures include a host-specific `gh auth refresh` recovery command. The board UI does not receive credentials.

## App and agent access

The screen provides card detail editing, linking, creation, movement, and removal where supported. Edits re-read the board from the provider. A failed action shows its error and keeps the input or card available. GitHub change notifications tell the app to re-read; they contain no card patch. This is polling, since GitHub project webhooks need a public delivery endpoint and a local Otto daemon does not open one.

The `kanban` Otto tool group exposes `kanban_list_boards`, `kanban_get_board`, `kanban_create_card`, `kanban_link_task`, `kanban_move_card`, `kanban_update_card`, and `kanban_delete_card`. Tools resolve the caller's project and its configured board on the host. Read permission admits list and get; execute permission is required for mutations. A card or field mutation checks board membership and editability before calling the provider. A provider that lacks an operation rejects that tool call.

## Verification boundary

`npm run validate:kanban-graphql -w @otto-code/server` validates the GraphQL documents against GitHub's live schema. Focused provider and tool tests exercise normalized reads, pagination, writes, and explicit errors through injected provider responses. Schema acceptance and mocked HTTP responses do not prove that a real user's board accepts a particular mutation; provider behavior and permissions must still be checked against a configured board before calling that integration end to end verified.
