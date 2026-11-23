import { expect, it } from "vitest";
import { createAtlassianHttp } from "../../../../services/otto/atlassian/http.js";
import { readJiraBoard } from "./reader.js";
import { readJiraCard } from "./details.js";
import { executeJiraCard } from "./execute.js";
import { jiraFieldPlan, jiraFieldValue, jiraWriteValue } from "./fields.js";
import { preflightMutation } from "../mutations/preflight.js";
import type { BoardMutationIntent } from "@getpaseo/plugin/otto/kanban";

function fixture() {
  const state = {
    denyEdit: false,
    denyTransitions: false,
    ambiguous: false,
    requiredScreen: false,
  };
  const writes: { endpoint: string; body: unknown }[] = [];
  const configuration = {
    id: 42,
    name: "Fixture",
    location: { id: "1", key: "OTTO", type: "project" },
    columnConfig: {
      columns: [
        { name: "Todo", statuses: [{ id: "1" }] },
        { name: "Done", statuses: [{ id: "2" }] },
      ],
    },
  };
  const issue = {
    id: "100",
    key: "OTTO-1",
    fields: {
      summary: "Original",
      description: "Body",
      updated: "2026-10-24T00:00:00Z",
      status: { id: "1" },
      labels: ["one"],
      assignee: null,
      priority: null,
    },
  };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (init?.method !== "GET") {
      writes.push({ endpoint: url.pathname, body: JSON.parse(String(init?.body)) });
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith("/configuration")) return Response.json(configuration);
    if (url.pathname.includes("/board/")) return Response.json({ isLast: true, issues: [issue] });
    if (url.pathname.endsWith("/editmeta")) {
      if (state.denyEdit) return new Response(null, { status: 403 });
      return Response.json({
        fields: {
          summary: {
            name: "Title",
            required: true,
            schema: { type: "string" },
            operations: ["set"],
          },
          description: { name: "Description", schema: { type: "string" }, operations: ["set"] },
          labels: {
            name: "Labels",
            schema: { type: "array", items: "string" },
            operations: ["set"],
          },
        },
      });
    }
    if (url.pathname.endsWith("/transitions")) {
      if (state.denyTransitions) return new Response(null, { status: 403 });
      const fields = state.requiredScreen
        ? { resolution: { name: "Resolution", required: true } }
        : {};
      const rows = [{ id: "done", to: { id: "2" }, fields }];
      if (state.ambiguous) rows.push({ id: "other", to: { id: "2" }, fields: {} });
      return Response.json({ transitions: rows });
    }
    return Response.json(issue);
  };
  const http = createAtlassianHttp({
    credential: {
      revision: "account-1",
      email: "fixture@example.test",
      apiToken: "fixture-token",
      siteUrl: "https://fixture.atlassian.net",
      route: { kind: "site" },
    },
    fetch,
  });
  async function read() {
    const board = await readJiraBoard({
      http,
      boardId: "42",
      siteUrl: "https://fixture.atlassian.net",
    });
    if (!board.ok) throw new Error(board.error.message);
    const card = await readJiraCard({
      http,
      board: board.value.board,
      configuration,
      cardId: "OTTO-1",
    });
    if (!card.ok) throw new Error(card.error.message);
    return card.value;
  }
  return { state, writes, read };
}
function intent(
  snapshot: Awaited<ReturnType<ReturnType<typeof fixture>["read"]>>["snapshot"],
): BoardMutationIntent {
  return {
    binding: { hostId: "host", projectId: "project" },
    operationId: "operation-00000001",
    boardId: snapshot.board.id,
    expectedSettingsRevision: "settings",
    expectedBoardRevision: snapshot.board.revision,
    mutation: {
      kind: "move",
      cardId: "OTTO-1",
      expectedCardRevision: snapshot.cardRevisions["OTTO-1"]!,
      columnId: "Done",
    },
  };
}
it("uses actual workflow transitions and explicit edit-screen permissions", async () => {
  const f = fixture();
  const { snapshot, context } = await f.read();
  expect(snapshot.board.capabilities).toMatchObject({ edit: true, move: true, remove: false });
  expect(snapshot.allowedMoves["OTTO-1"]).toEqual(["Done"]);
  const request = intent(snapshot);
  expect(preflightMutation(request, snapshot)).toEqual({ ok: true, value: true });
  expect(await executeJiraCard(request, context)).toEqual({ status: "applied" });
  expect(f.writes).toEqual([
    { endpoint: "/rest/api/3/issue/OTTO-1/transitions", body: { transition: { id: "done" } } },
  ]);
});
it("keeps readable fields when edit and workflow actions are denied", async () => {
  const f = fixture();
  f.state.denyEdit = true;
  f.state.denyTransitions = true;
  const { snapshot } = await f.read();
  expect(snapshot.board.capabilities).toMatchObject({ edit: false, move: false, remove: false });
  expect(snapshot.cardFields["OTTO-1"]).toContainEqual({
    fieldId: "summary",
    editable: false,
    display: "Original",
    value: { kind: "text", value: "Original" },
  });
  expect(f.writes).toEqual([]);
});
it.each(["ambiguous", "requiredScreen"] as const)(
  "does not guess a transition for %s",
  async (flag) => {
    const f = fixture();
    f.state[flag] = true;
    const { snapshot } = await f.read();
    expect(snapshot.allowedMoves["OTTO-1"]).toEqual([]);
    expect(snapshot.board.capabilities.move).toBe(false);
  },
);
it("rejects clearing a required field before any provider write", async () => {
  const f = fixture();
  const { snapshot } = await f.read();
  const request = intent(snapshot);
  request.mutation = {
    kind: "edit",
    cardId: "OTTO-1",
    expectedCardRevision: snapshot.cardRevisions["OTTO-1"]!,
    fieldId: "summary",
    value: { kind: "clear" },
  };
  expect(preflightMutation(request, snapshot).ok).toBe(false);
  expect(f.writes).toEqual([]);
});
it("writes only the selected editable field and keeps description structure untouched otherwise", async () => {
  const f = fixture();
  const { snapshot, context } = await f.read();
  const request = intent(snapshot);
  request.mutation = {
    kind: "edit",
    cardId: "OTTO-1",
    expectedCardRevision: snapshot.cardRevisions["OTTO-1"]!,
    fieldId: "labels",
    value: { kind: "text", value: "one, two, one" },
  };
  expect(await executeJiraCard(request, context)).toEqual({ status: "applied" });
  expect(f.writes).toEqual([
    { endpoint: "/rest/api/3/issue/OTTO-1", body: { fields: { labels: ["one", "two"] } } },
  ]);
});
it("treats unknown field types as read-only and uses accountId for people", () => {
  const unknown = jiraFieldPlan(
    "custom",
    { name: "Opaque", schema: { type: "object" }, operations: ["set"] },
    [],
  );
  expect(unknown.writable).toBe(false);
  const person = jiraFieldPlan(
    "assignee",
    { name: "Assignee", schema: { type: "user" }, operations: ["set"] },
    [{ id: "opaque-account", label: "Person" }],
  );
  expect(jiraFieldValue(person, { accountId: "opaque-account", displayName: "Person" })).toEqual({
    ok: true,
    value: { kind: "choice", id: "opaque-account" },
  });
  expect(jiraWriteValue(person, { kind: "choice", id: "opaque-account" })).toEqual({
    ok: true,
    value: { accountId: "opaque-account" },
  });
});
it("does not interpret malformed selected values as a field clear", () => {
  const field = jiraFieldPlan(
    "assignee",
    { name: "Assignee", schema: { type: "user" }, operations: ["set"] },
    [{ id: "person", label: "Person" }],
  );
  expect(jiraFieldValue(field, { displayName: "Missing account identity" })).toMatchObject({
    ok: false,
    error: { code: "invalid_response" },
  });
  const priority = jiraFieldPlan("priority", { name: "Priority", schema: { type: "option" } }, []);
  expect(jiraFieldValue(priority, { id: "1", name: "High" })).toEqual({
    ok: true,
    value: { kind: "text", value: "High" },
  });
});
