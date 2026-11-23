import { expect, it } from "vitest";
import {
  BoardMutationIntentSchema,
  getBoard,
  getEditableBoard,
  getJiraCreateOptions,
  mutateBoard,
  type EditableBoard,
} from "@getpaseo/plugin/otto/kanban";
import { createKanbanTools } from "./tools.js";
import { createKanbanCatalogTools, type KanbanCaller } from "./catalog.js";
import { createPersistedWorkspaceRecord } from "../../workspace-registry.js";

const binding = { hostId: "host", projectId: "project" };
function fixture() {
  const snapshot: EditableBoard = {
    board: {
      provider: "github",
      id: "board",
      title: "Configured board",
      url: "https://github.com/orgs/owner/projects/1",
      revision: "board-revision",
      capabilities: { read: true, create: true, link: true, move: true, edit: true, remove: true },
      columns: [{ id: "todo", title: "Todo" }],
      cards: Array.from({ length: 60 }, (_, index) => ({
        id: `card-${index}`,
        title: `Card ${index}`,
        description: `private-body-${index}`,
        url: null,
        columnId: "todo",
        kind: "issue",
        assignees: [],
        archived: false,
      })),
    },
    fields: [{ id: "title", name: "Title", kind: "text", choices: [] }],
    cardFields: {
      "card-1": [
        {
          fieldId: "title",
          editable: true,
          display: "Card 1",
          value: { kind: "text", value: "Card 1" },
        },
      ],
    },
    cardRevisions: { "card-1": "card-revision" },
    allowedMoves: { "card-1": ["todo"] },
  };
  const calls: { method: string; input: unknown }[] = [];
  const host = {
    hostId: "host",
    invoke: async (method: string, input: unknown): Promise<unknown> => {
      calls.push({ method, input });
      if (method === getBoard.name)
        return { status: "ready", binding, settingsRevision: "settings", board: snapshot.board };
      if (method === getEditableBoard.name)
        return { status: "ready", binding, settingsRevision: "settings", snapshot };
      if (method === getJiraCreateOptions.name)
        return {
          ok: true,
          value: {
            projects: [],
            issueTypes: [],
            revision: null,
            available: false,
            message: "Select project",
          },
        };
      const intent = BoardMutationIntentSchema.parse(input);
      return { status: "applied", operationId: intent.operationId, snapshot };
    },
  };
  const tools = createKanbanTools(host, async () => binding);
  const run = (name: string, input: unknown) => {
    const tool = tools.find((entry) => entry.name === name);
    if (!tool) throw new Error(`Missing ${name}`);
    return tool.handler(input, {});
  };
  return { snapshot, calls, host, tools, run };
}
const write = {
  operationId: "stable-operation-001",
  boardId: "board",
  expectedSettingsRevision: "settings",
  expectedBoardRevision: "board-revision",
};
it("advertises all historical actions and explicit Jira creation discovery through one host", async () => {
  const f = fixture();
  expect(f.tools.map((tool) => tool.name)).toEqual([
    "kanban_list_boards",
    "kanban_get_board",
    "kanban_get_create_options",
    "kanban_create_card",
    "kanban_link_task",
    "kanban_move_card",
    "kanban_update_card",
    "kanban_delete_card",
  ]);
  const result = await f.run("kanban_list_boards", {});
  expect(result.structuredContent).toMatchObject({
    status: "ready",
    binding,
    boards: [{ id: "board", totalCards: 60 }],
  });
  expect(JSON.stringify(result)).not.toContain("private-body");
  expect(f.calls[0]).toEqual({ method: getBoard.name, input: binding });
});
it("pages card summaries without injecting their bodies and pins subsequent pages", async () => {
  const f = fixture();
  const result = await f.run("kanban_get_board", {
    offset: 10,
    limit: 10,
    expectedBoardRevision: "board-revision",
  });
  expect(result.structuredContent).toMatchObject({
    status: "ready",
    totalCards: 60,
    nextOffset: 20,
    cards: expect.arrayContaining([
      expect.objectContaining({ id: "card-10", descriptionCharacters: 15 }),
    ]),
  });
  expect(result.structuredContent).toHaveProperty("cards.length", 10);
  expect(JSON.stringify(result)).not.toContain("private-body");
  const stale = await f.run("kanban_get_board", { offset: 10, expectedBoardRevision: "old" });
  expect(stale).toMatchObject({
    isError: true,
    structuredContent: { status: "error", error: { code: "revision_conflict" } },
  });
});
it("retrieves one card body, revision and field options only on demand", async () => {
  const f = fixture();
  const result = await f.run("kanban_get_board", { cardId: "card-1", fieldId: "title" });
  expect(result.structuredContent).toMatchObject({
    cards: [{ id: "card-1", description: "private-body-1" }],
    editing: {
      cardRevision: "card-revision",
      selectedField: {
        definition: { id: "title" },
        value: { value: { kind: "text", value: "Card 1" } },
      },
    },
  });
  expect(JSON.stringify(result)).not.toContain("private-body-0");
  expect(f.calls[0]).toEqual({
    method: getEditableBoard.name,
    input: { binding, cardId: "card-1" },
  });
});
it("reads a card body without asking for editing authority", async () => {
  const f = fixture();
  const result = await f.run("kanban_get_board", { cardId: "card-1" });
  expect(result.structuredContent).toMatchObject({
    cards: [{ id: "card-1", description: "private-body-1" }],
    editing: null,
  });
  expect(f.calls).toEqual([{ method: getBoard.name, input: binding }]);
});
it("refuses a missing card, invalid paging and unscoped fields without inventing values", async () => {
  const f = fixture();
  expect(await f.run("kanban_get_board", { cardId: "gone" })).toMatchObject({
    isError: true,
    structuredContent: { error: { code: "not_found" } },
  });
  expect(await f.run("kanban_get_board", { fieldId: "title" })).toMatchObject({ isError: true });
  expect(await f.run("kanban_get_board", { limit: 101 })).toMatchObject({ isError: true });
});
it.each([
  { hostId: "other" },
  { projectId: "other" },
  { rootPath: "C:/private" },
  { token: "secret" },
])(
  "refuses caller-supplied routing or credentials before touching the provider: %j",
  async (input) => {
    const f = fixture();
    expect(await f.run("kanban_list_boards", input)).toMatchObject({ isError: true });
    expect(f.calls).toEqual([]);
  },
);
it.each([
  {
    name: "kanban_create_card",
    mutation: { title: "New card", description: "Body", columnId: null },
    kind: "create",
  },
  {
    name: "kanban_link_task",
    mutation: { reference: "owner/repo#1", columnId: "todo" },
    kind: "link",
  },
  {
    name: "kanban_move_card",
    mutation: { cardId: "card-1", expectedCardRevision: "card-revision", columnId: "todo" },
    kind: "move",
  },
  {
    name: "kanban_update_card",
    mutation: {
      cardId: "card-1",
      expectedCardRevision: "card-revision",
      fieldId: "title",
      value: { kind: "text", value: "New title" },
    },
    kind: "edit",
  },
  {
    name: "kanban_delete_card",
    mutation: { cardId: "card-1", expectedCardRevision: "card-revision" },
    kind: "remove",
  },
])(
  "forwards one validated $kind intent with the caller's operation and CAS identity",
  async ({ name, mutation, kind }) => {
    const f = fixture();
    const result = await f.run(name, { ...write, ...mutation });
    expect(result.structuredContent).toMatchObject({
      status: "applied",
      operationId: write.operationId,
      boardRevision: "board-revision",
    });
    expect(f.calls).toEqual([
      { method: mutateBoard.name, input: { ...write, binding, mutation: { kind, ...mutation } } },
    ]);
    expect(JSON.stringify(result)).not.toContain("private-body");
  },
);
it("requires stable operation IDs and complete captured revisions before mutation admission", async () => {
  const f = fixture();
  expect(
    await f.run("kanban_create_card", {
      ...write,
      operationId: "short",
      title: "x",
      description: "",
      columnId: null,
    }),
  ).toMatchObject({ isError: true });
  expect(f.calls).toEqual([]);
});
it("uses the same host Jira creation-metadata port with explicit choices and revisions", async () => {
  const f = fixture();
  const input = {
    expectedSettingsRevision: "settings",
    expectedBoardRevision: "board-revision",
    projectId: "jira-project",
    issueTypeId: "issue-type",
  };
  await f.run("kanban_get_create_options", input);
  expect(f.calls).toEqual([{ method: getJiraCreateOptions.name, input: { ...input, binding } }]);
});
it("preserves uncertain operation identity without an automatic second write or raw provider exception", async () => {
  let attempts = 0;
  const tools = createKanbanTools(
    {
      invoke: async () => {
        attempts++;
        return {
          status: "reconciliation_required",
          operationId: write.operationId,
          error: { code: "unavailable", message: "Refresh before reconciliation" },
        };
      },
    },
    async () => binding,
  );
  const tool = tools.find((entry) => entry.name === "kanban_create_card");
  if (!tool) throw new Error("Missing tool");
  expect(
    await tool.handler({ ...write, title: "x", description: "", columnId: null }, {}),
  ).toMatchObject({
    isError: true,
    structuredContent: { status: "reconciliation_required", operationId: write.operationId },
  });
  expect(attempts).toBe(1);
  const failing = createKanbanTools(
    {
      invoke: async () => {
        throw new Error("private token /home/secret");
      },
    },
    async () => binding,
  )[0];
  const result = await failing.handler({}, {});
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result)).not.toContain("private token");
});
it("bounds an oversized field response instead of sending a knowingly partial value", async () => {
  const f = fixture();
  f.snapshot.fields[0].choices = [{ id: "huge", label: "x".repeat(210000) }];
  expect(await f.run("kanban_get_board", { cardId: "card-1", fieldId: "title" })).toMatchObject({
    isError: true,
    structuredContent: { error: { code: "read_limit" } },
  });
});
it("resolves active registry identity and prevents cross-project or locked voice/workspace routing", async () => {
  const f = fixture();
  const workspace = (workspaceId: string, projectId: string) =>
    createPersistedWorkspaceRecord({
      workspaceId,
      projectId,
      cwd: `C:/fixtures/${workspaceId}`,
      kind: "directory",
      displayName: workspaceId,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    });
  const records = new Map(
    [
      workspace("mine", "project"),
      workspace("branch", "project"),
      workspace("foreign", "other"),
    ].map((record) => [record.workspaceId, record]),
  );
  let caller: KanbanCaller = { bound: true, workspaceId: "mine", locked: false };
  const tools = createKanbanCatalogTools({
    host: f.host,
    workspaces: { get: async (id) => records.get(id) ?? null },
    caller: () => caller,
  });
  const list = tools[0];
  expect(await list.handler({}, {})).toMatchObject({ structuredContent: { binding } });
  expect(await list.handler({ workspaceId: "branch" }, {})).toMatchObject({
    structuredContent: { binding },
  });
  const calls = f.calls.length;
  expect(await list.handler({ workspaceId: "foreign" }, {})).toMatchObject({ isError: true });
  expect(f.calls).toHaveLength(calls);
  caller = { ...caller, locked: true };
  expect(await list.handler({ workspaceId: "branch" }, {})).toMatchObject({ isError: true });
  caller = { bound: true, workspaceId: null, locked: false };
  expect(await list.handler({ workspaceId: "mine" }, {})).toMatchObject({ isError: true });
  caller = { bound: false, workspaceId: null, locked: false };
  expect(await list.handler({}, {})).toMatchObject({ isError: true });
  expect(await list.handler({ workspaceId: "mine" }, {})).toMatchObject({
    structuredContent: { binding },
  });
  records.delete("mine");
  expect(await list.handler({ workspaceId: "mine" }, {})).toMatchObject({ isError: true });
});
it("checks the live retained provider policy before contacting the board service", async () => {
  const f = fixture();
  let enabled = false;
  const decisions: unknown[] = [];
  const record = createPersistedWorkspaceRecord({
    workspaceId: "mine",
    projectId: "project",
    cwd: "C:/fixture",
    kind: "directory",
    displayName: "Mine",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  });
  const tools = createKanbanCatalogTools({
    host: f.host,
    workspaces: { get: async () => record },
    caller: () => ({ bound: true, workspaceId: "mine", locked: false, provider: "local" }),
    policy: async (name, provider) => {
      decisions.push({ name, provider });
      return enabled;
    },
  });
  expect(await tools[0].handler({}, {})).toMatchObject({
    isError: true,
    structuredContent: { error: { code: "access_denied" } },
  });
  expect(f.calls).toEqual([]);
  expect(decisions).toEqual([{ name: "kanban_list_boards", provider: "local" }]);
  enabled = true;
  expect(await tools[0].handler({}, {})).toMatchObject({ structuredContent: { status: "ready" } });
  expect(f.calls).toHaveLength(1);
});
