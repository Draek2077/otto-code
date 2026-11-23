import { expect, it } from "vitest";
import type { Board, BoardMutationIntent, EditableBoard } from "@getpaseo/plugin/otto/kanban";
import type { GitHubProjectReads } from "../../../../services/otto/github-projects.js";
import type { GitHubBoardCommand } from "../../../../services/otto/github-project-commands.js";
import {
  editableFieldsDocument,
  cardDetailsDocument,
  repositoryChoicesDocument,
  linkContentDocument,
} from "../../../../services/otto/github-project-details-documents.js";
import { readGitHubEditing, type GitHubMutationContext } from "./github-details.js";
import { executeGitHubMutation } from "./github-execute.js";
import { preflightMutation } from "./preflight.js";

const end = { hasNextPage: false, endCursor: null };
function board(): Board {
  return {
    provider: "github",
    id: "board",
    title: "Board",
    url: "https://github.com/orgs/owner/projects/1",
    revision: "board-1",
    capabilities: {
      read: true,
      create: false,
      link: false,
      move: false,
      edit: false,
      remove: false,
    },
    columns: [
      { id: "todo", title: "Todo" },
      { id: "done", title: "Done" },
      { id: "otto:unassigned", title: "Unassigned" },
    ],
    cards: [
      {
        id: "card",
        title: "Issue",
        description: "Body",
        url: "https://github.com/owner/repo/issues/1",
        columnId: "todo",
        kind: "Issue",
        assignees: ["owner"],
        archived: false,
      },
    ],
  };
}
function fixture() {
  const fields = [
    { id: "title", name: "Title", dataType: "TITLE", __typename: "ProjectV2Field" },
    {
      id: "status",
      name: "Status",
      dataType: "SINGLE_SELECT",
      __typename: "ProjectV2SingleSelectField",
      options: [
        { id: "todo", name: "Todo" },
        { id: "done", name: "Done" },
      ],
    },
    {
      id: "priority",
      name: "Priority",
      dataType: "SINGLE_SELECT",
      __typename: "ProjectV2SingleSelectField",
      options: [{ id: "high", name: "High" }],
    },
    { id: "due", name: "Due date", dataType: "DATE", __typename: "ProjectV2Field" },
    { id: "people", name: "Assignees", dataType: "ASSIGNEES", __typename: "ProjectV2Field" },
    { id: "labels", name: "Labels", dataType: "LABELS", __typename: "ProjectV2Field" },
    { id: "computed", name: "Repository", dataType: "REPOSITORY", __typename: "ProjectV2Field" },
  ];
  const content = {
    __typename: "Issue",
    id: "issue",
    title: "Issue",
    body: "Body",
    updatedAt: "content-1",
    viewerCanUpdate: true,
    repository: { id: "repository", nameWithOwner: "owner/repo" },
    assignees: { nodes: [{ id: "user", login: "owner" }], pageInfo: end },
    labels: { nodes: [{ id: "bug", name: "Bug" }], pageInfo: end },
  };
  const values = [
    {
      __typename: "ProjectV2ItemFieldSingleSelectValue",
      field: { id: "priority" },
      optionId: "high",
    },
    { __typename: "ProjectV2ItemFieldDateValue", field: { id: "due" }, date: "2026-10-24" },
  ];
  const state = {
    projectId: "board",
    writable: true,
    content,
    fields,
    values,
    duplicateCursor: false,
    partial: false,
  };
  const calls: Array<{ document: string; variables: Record<string, string | number | null> }> = [];
  const writes: GitHubBoardCommand[] = [];
  const effect = { uncertainAt: 0 };
  const reads: GitHubProjectReads = {
    repository: async () => ({ owner: "owner", repository: "repo" }),
    query: async (input) => {
      calls.push(input);
      const cursor = input.variables.cursor;
      let data: unknown;
      if (input.document === editableFieldsDocument)
        data = {
          node: {
            id: "board",
            updatedAt: "board-1",
            viewerCanUpdate: state.writable,
            fields: {
              nodes: cursor ? state.fields.slice(2) : state.fields.slice(0, 2),
              pageInfo:
                cursor && !state.duplicateCursor
                  ? end
                  : { hasNextPage: true, endCursor: "fields-2" },
            },
          },
        };
      else if (input.document === cardDetailsDocument)
        data = {
          node: {
            id: "card",
            project: { id: state.projectId },
            updatedAt: "item-1",
            content: state.content,
            fieldValues: { nodes: state.values, pageInfo: end },
          },
        };
      else if (input.document === repositoryChoicesDocument) {
        const nextPeople = input.variables.peopleCursor !== null;
        data = {
          repository: {
            id: "repository",
            assignableUsers: {
              nodes: nextPeople
                ? [{ id: "peer", login: "peer" }]
                : [{ id: "user", login: "owner" }],
              pageInfo: nextPeople ? end : { hasNextPage: true, endCursor: "people-2" },
            },
            labels: { nodes: [{ id: "bug", name: "Bug" }], pageInfo: end },
          },
        };
      } else if (input.document === linkContentDocument)
        data = { resource: { __typename: "Issue", id: "linked-issue", url: input.variables.url } };
      else throw new Error("Unexpected query");
      return {
        ok: true,
        value: { data, ...(state.partial ? { errors: [{ type: "FORBIDDEN" }] } : {}) },
      };
    },
  };
  const port = {
    execute: async ({ command }: { command: GitHubBoardCommand }) => {
      writes.push(command);
      if (writes.length === effect.uncertainAt) return { status: "uncertain" as const };
      return {
        status: "applied" as const,
        id: command.kind === "create" || command.kind === "link" ? "new-item" : "card",
      };
    },
  };
  const read = () =>
    readGitHubEditing({
      port: reads,
      cwd: "selected-project",
      board: board(),
      cardId: "card",
      remote: { owner: "owner", repository: "repo" },
    });
  return { state, calls, writes, effect, reads, port, read };
}
function intent(
  snapshot: EditableBoard,
  mutation: BoardMutationIntent["mutation"],
): BoardMutationIntent {
  return {
    binding: { hostId: "host", projectId: "project" },
    operationId: "operation-00000001",
    boardId: snapshot.board.id,
    expectedBoardRevision: snapshot.board.revision,
    expectedSettingsRevision: "settings-1",
    mutation,
  };
}
async function current(f: ReturnType<typeof fixture>) {
  const response = await f.read();
  if (!response.ok) throw new Error(response.error.message);
  return response.value;
}
it("loads per-card editable fields, real choices and independent paginated metadata", async () => {
  const f = fixture();
  const result = await current(f);
  expect(result.snapshot.board.capabilities).toEqual({
    read: true,
    create: true,
    link: true,
    move: true,
    edit: true,
    remove: true,
  });
  expect(result.snapshot.fields.find((field) => field.id === "people")?.choices).toEqual([
    { id: "user", label: "owner" },
    { id: "peer", label: "peer" },
  ]);
  expect(result.snapshot.cardFields.card).toContainEqual({
    fieldId: "due",
    editable: true,
    display: "2026-10-24",
    value: { kind: "date", value: "2026-10-24" },
  });
  expect(result.snapshot.cardFields.card).toContainEqual({
    fieldId: "computed",
    editable: false,
    display: "",
    value: null,
  });
  expect(result.snapshot.allowedMoves.card).toEqual(["todo", "done"]);
  expect(
    f.calls
      .filter((call) => call.document === editableFieldsDocument)
      .map((call) => call.variables.cursor),
  ).toEqual([null, "fields-2"]);
  expect(
    f.calls
      .filter((call) => call.document === repositoryChoicesDocument)
      .map((call) => call.variables.peopleCursor),
  ).toEqual([null, "people-2"]);
});
it("changes the card revision when content or a project field changes", async () => {
  const f = fixture();
  const first = await current(f);
  f.state.content.body = "Peer edit";
  const second = await current(f);
  expect(second.snapshot.cardRevisions.card).not.toBe(first.snapshot.cardRevisions.card);
  f.state.values[0]!.optionId = "different";
  const third = await current(f);
  expect(third.snapshot.cardRevisions.card).not.toBe(second.snapshot.cardRevisions.card);
});
it("uses content and project permissions independently", async () => {
  const f = fixture();
  f.state.content.viewerCanUpdate = false;
  const result = await current(f);
  expect(
    result.snapshot.cardFields.card?.find((field) => field.fieldId === "title")?.editable,
  ).toBe(false);
  expect(
    result.snapshot.cardFields.card?.find((field) => field.fieldId === "priority")?.editable,
  ).toBe(true);
});
it("refuses a card belonging to another project", async () => {
  const f = fixture();
  f.state.projectId = "other";
  expect(await f.read()).toMatchObject({ ok: false, error: { code: "not_found" } });
});
it("does not return partial metadata or repeat pagination cursors", async () => {
  const f = fixture();
  f.state.partial = true;
  expect(await f.read()).toMatchObject({ ok: false, error: { code: "access_denied" } });
  f.state.partial = false;
  f.state.duplicateCursor = true;
  expect(await f.read()).toMatchObject({ ok: false, error: { code: "invalid_response" } });
});
async function execute(
  f: ReturnType<typeof fixture>,
  state: { snapshot: EditableBoard; context: GitHubMutationContext },
  mutation: BoardMutationIntent["mutation"],
) {
  return executeGitHubMutation({
    intent: intent(state.snapshot, mutation),
    ...state,
    reads: f.reads,
    writes: f.port,
  });
}
it("creates a draft and places exactly its acknowledged item into the chosen column", async () => {
  const f = fixture();
  const state = await current(f);
  expect(
    await execute(f, state, {
      kind: "create",
      title: "New",
      description: "Body",
      columnId: "done",
    }),
  ).toEqual({ status: "applied" });
  expect(f.writes).toEqual([
    { kind: "create", projectId: "board", title: "New", body: "Body" },
    {
      kind: "field",
      projectId: "board",
      itemId: "new-item",
      fieldId: "status",
      value: { kind: "choice", id: "done" },
    },
  ]);
});
it("reports a partial create as uncertain without repeating creation", async () => {
  const f = fixture();
  f.effect.uncertainAt = 2;
  const state = await current(f);
  expect(
    await execute(f, state, { kind: "create", title: "New", description: "", columnId: "done" }),
  ).toMatchObject({ status: "uncertain" });
  expect(f.writes.map((command) => command.kind)).toEqual(["create", "field"]);
});
it("routes issue body edits to content and priority edits to the project field", async () => {
  const f = fixture();
  const state = await current(f);
  const identity = { cardId: "card", expectedCardRevision: state.snapshot.cardRevisions.card! };
  expect(
    await execute(f, state, {
      kind: "edit",
      ...identity,
      fieldId: "otto.body",
      value: { kind: "text", value: "Changed" },
    }),
  ).toEqual({ status: "applied" });
  expect(
    await execute(f, state, {
      kind: "edit",
      ...identity,
      fieldId: "priority",
      value: { kind: "choice", id: "high" },
    }),
  ).toEqual({ status: "applied" });
  expect(f.writes).toEqual([
    { kind: "content", contentKind: "Issue", contentId: "issue", field: "body", value: "Changed" },
    {
      kind: "field",
      projectId: "board",
      itemId: "card",
      fieldId: "priority",
      value: { kind: "choice", id: "high" },
    },
  ]);
});
it("resolves only same-host issue/PR URLs, refuses duplicates and never opens arbitrary endpoints", async () => {
  const f = fixture();
  const state = await current(f);
  expect(
    await execute(f, state, {
      kind: "link",
      reference: "https://evil.invalid/owner/repo/issues/2",
      columnId: null,
    }),
  ).toMatchObject({ status: "rejected" });
  expect(
    await execute(f, state, {
      kind: "link",
      reference: "https://github.com/owner/repo/issues/1",
      columnId: null,
    }),
  ).toMatchObject({ status: "rejected" });
  expect(f.writes).toEqual([]);
  expect(
    await execute(f, state, {
      kind: "link",
      reference: "https://github.com/owner/repo/issues/2",
      columnId: null,
    }),
  ).toEqual({ status: "applied" });
  expect(f.writes).toEqual([{ kind: "link", projectId: "board", contentId: "linked-issue" }]);
});
it("refuses a nonexistent calendar date before provider effects", async () => {
  const f = fixture();
  const state = await current(f);
  const input = intent(state.snapshot, {
    kind: "edit",
    cardId: "card",
    expectedCardRevision: state.snapshot.cardRevisions.card!,
    fieldId: "due",
    value: { kind: "date", value: "2026-02-30" },
  });
  expect(preflightMutation(input, state.snapshot)).toMatchObject({
    ok: false,
    error: { code: "unsupported" },
  });
  expect(f.writes).toEqual([]);
});
