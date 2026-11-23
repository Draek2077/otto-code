import { expect, it } from "vitest";
import type { BoardMutationIntent, BoardMutationOutcome, EditableBoard } from "../shared/model.js";
import { openBoardAction, type ActionMode } from "./action-form.js";
import { BoardActionDrafts } from "./action-drafts.js";

function snapshot(): EditableBoard {
  return {
    board: {
      provider: "github",
      id: "board",
      title: "Board",
      url: null,
      revision: "board-1",
      capabilities: { read: true, create: true, link: true, move: true, edit: true, remove: true },
      columns: [{ id: "todo", title: "Todo" }],
      cards: [
        {
          id: "card",
          title: "Card",
          description: "",
          url: null,
          kind: "Issue",
          columnId: "todo",
          assignees: [],
          archived: false,
        },
      ],
    },
    fields: [
      { id: "title", name: "Title", kind: "text", choices: [] },
      { id: "points", name: "Points", kind: "number", choices: [] },
    ],
    cardFields: {
      card: [
        {
          fieldId: "title",
          editable: true,
          display: "Card",
          value: { kind: "text", value: "Card" },
        },
        { fieldId: "points", editable: true, display: "3", value: { kind: "number", value: 3 } },
      ],
    },
    cardRevisions: { card: "card-1" },
    allowedMoves: { card: ["todo"] },
  };
}
function fixture(mode: ActionMode = "create") {
  const calls: BoardMutationIntent[] = [];
  const origin = {
    binding: { hostId: "host", projectId: "project" },
    settingsRevision: "settings-1",
    snapshot: snapshot(),
    ...(mode === "create" || mode === "link" ? {} : { cardId: "card" }),
  };
  let count = 0;
  const port = {
    run: async (intent: BoardMutationIntent): Promise<BoardMutationOutcome> => ({
      status: "applied",
      operationId: intent.operationId,
      snapshot: origin.snapshot,
    }),
  };
  const input = {
    origin,
    mode,
    operationId: () => `operation-${String(++count).padStart(16, "0")}`,
    submit: async (intent: BoardMutationIntent) => {
      calls.push(intent);
      return port.run(intent);
    },
  };
  return { input, origin, calls, port, model: openBoardAction(input) };
}
it("submits explicit creation once with its originating host, project and revisions", async () => {
  const f = fixture();
  f.model.setTitle("New");
  f.model.setDescription("Body");
  expect(f.model.canSubmit()).toBe(true);
  await f.model.submit();
  await f.model.submit();
  expect(f.calls).toEqual([
    {
      binding: f.origin.binding,
      operationId: "operation-0000000000000001",
      boardId: "board",
      expectedSettingsRevision: "settings-1",
      expectedBoardRevision: "board-1",
      mutation: { kind: "create", title: "New", description: "Body", columnId: null },
    },
  ]);
  expect(f.model.getSnapshot()).toMatchObject({ saved: true, dirty: false, busy: false });
});
it("requires explicit ready Jira creation choices and carries their origin revision into the real action form", async () => {
  const f = fixture();
  f.origin.snapshot.board.provider = "jira";
  const model = openBoardAction({
    ...f.input,
    readCreation: async () => ({
      ok: true,
      value: {
        projects: [{ id: "jira-project", label: "Project" }],
        issueTypes: [{ id: "task", label: "Task" }],
        revision: "create-origin",
        available: true,
        message: null,
      },
    }),
  });
  model.setTitle("New Jira issue");
  expect(model.canSubmit()).toBe(false);
  const creation = model.creation;
  if (!creation) throw new Error("Expected Jira choices");
  const hide = creation.activate();
  await creation.reload();
  creation.selectProject("jira-project");
  await creation.reload();
  creation.selectType("task");
  await creation.reload();
  expect(model.canSubmit()).toBe(true);
  await model.submit();
  expect(f.calls).toMatchObject([
    {
      binding: f.origin.binding,
      expectedSettingsRevision: "settings-1",
      expectedBoardRevision: "board-1",
      mutation: {
        kind: "create",
        jira: {
          projectId: "jira-project",
          issueTypeId: "task",
          expectedCreateRevision: "create-origin",
        },
      },
    },
  ]);
  hide();
});
it("refuses clear and whitespace values for a required provider field", async () => {
  const f = fixture("edit");
  const title = f.origin.snapshot.fields.find((field) => field.id === "title");
  if (!title) throw new Error("Expected title fixture");
  title.required = true;
  f.model.setField("title");
  f.model.setValue({ kind: "clear" });
  expect(f.model.canSubmit()).toBe(false);
  f.model.setValue({ kind: "text", value: " " });
  expect(f.model.canSubmit()).toBe(false);
  await f.model.submit();
  expect(f.calls).toEqual([]);
  f.model.setValue({ kind: "text", value: "Required title" });
  expect(f.model.canSubmit()).toBe(true);
});
it("serializes a pending action and preserves its exact intent across repeated clicks", async () => {
  const f = fixture();
  let release: ((value: BoardMutationOutcome) => void) | undefined;
  f.port.run = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  f.model.setTitle("Original");
  const pending = f.model.submit();
  f.model.setTitle("Changed while busy");
  expect(await f.model.submit()).toBeNull();
  expect(f.model.getSnapshot()).toMatchObject({ busy: true, title: "Original" });
  if (!release) throw new Error("Expected pending action");
  release({ status: "applied", operationId: f.calls[0]!.operationId, snapshot: f.origin.snapshot });
  await pending;
  expect(f.calls).toHaveLength(1);
});
it.each(["conflict", "unknown", "disconnect"])(
  "retains a draft and blocks resubmission after %s",
  async (failure) => {
    const f = fixture();
    f.port.run = async (intent) => {
      if (failure === "disconnect") throw new Error("Connection lost");
      if (failure === "unknown")
        return {
          status: "reconciliation_required",
          operationId: intent.operationId,
          error: { code: "unavailable", message: "Reconcile" },
        };
      return {
        status: "rejected",
        operationId: intent.operationId,
        error: { code: "revision_conflict", message: "Refresh" },
      };
    };
    f.model.setTitle("Keep my draft");
    await f.model.submit();
    f.model.setTitle("Still mine");
    expect(await f.model.submit()).toBeNull();
    expect(f.model.getSnapshot()).toMatchObject({
      blocked: true,
      title: "Still mine",
      dirty: true,
    });
    expect(f.calls).toHaveLength(1);
  },
);
it("allows an explicit correction after a proven validation rejection without rebasing", async () => {
  const f = fixture();
  f.port.run = async (intent) => ({
    status: "rejected",
    operationId: intent.operationId,
    error: { code: "invalid_target", message: "Correct title" },
  });
  f.model.setTitle("First");
  await f.model.submit();
  f.model.setTitle("Corrected");
  await f.model.submit();
  expect(
    f.calls.map((call) => [
      call.operationId,
      call.expectedSettingsRevision,
      call.expectedBoardRevision,
    ]),
  ).toEqual([
    ["operation-0000000000000001", "settings-1", "board-1"],
    ["operation-0000000000000002", "settings-1", "board-1"],
  ]);
});
it("binds field edits to the exact card revision and preserves finite decimal input", async () => {
  const f = fixture("edit");
  f.model.setField("points");
  f.model.setNumber("3.25");
  await f.model.submit();
  expect(f.calls[0]?.mutation).toEqual({
    kind: "edit",
    cardId: "card",
    expectedCardRevision: "card-1",
    fieldId: "points",
    value: { kind: "number", value: 3.25 },
  });
});
it("requires an explicit removal confirmation and a real allowed transition", async () => {
  const f = fixture("remove");
  expect(f.model.canSubmit()).toBe(false);
  f.model.confirmRemove();
  expect(f.model.canSubmit()).toBe(true);
  f.model.setMode("move");
  f.model.setColumn("not-a-transition");
  expect(f.model.canSubmit()).toBe(false);
  f.model.setColumn("todo");
  expect(f.model.canSubmit()).toBe(true);
});
it("retains dirty and pending intent across route/host selection without changing its origin", async () => {
  const f = fixture();
  const drafts = new BoardActionDrafts();
  const model = drafts.open(f.input);
  model.setTitle("Retain");
  expect(drafts.get({ hostId: "other", projectId: "project" })).toBeNull();
  const reopened = drafts.open({
    ...f.input,
    origin: { ...f.origin, settingsRevision: "peer-new" },
  });
  expect(reopened).toBe(model);
  await reopened.submit();
  expect(f.calls[0]?.expectedSettingsRevision).toBe("settings-1");
  expect(drafts.discard(model)).toBe(true);
  expect(drafts.get(f.origin.binding)).toBeNull();
});
it("does not publish a late result after the owning installation closes", async () => {
  const f = fixture();
  let release: ((value: BoardMutationOutcome) => void) | undefined;
  f.port.run = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  f.model.setTitle("New");
  const pending = f.model.submit();
  f.model.close();
  const closed = f.model.getSnapshot();
  if (!release) throw new Error("Expected pending action");
  release({ status: "applied", operationId: f.calls[0]!.operationId, snapshot: f.origin.snapshot });
  await pending;
  expect(f.model.getSnapshot()).toBe(closed);
});
it("refuses an oversized title locally and clears numeric intent without retaining the old number", () => {
  const f = fixture();
  f.model.setTitle("x".repeat(1025));
  expect(f.model.canSubmit()).toBe(false);
  const edit = fixture("edit");
  edit.model.setField("points");
  edit.model.setValue({ kind: "clear" });
  expect(edit.model.getSnapshot()).toMatchObject({ numberText: "", value: { kind: "clear" } });
});
