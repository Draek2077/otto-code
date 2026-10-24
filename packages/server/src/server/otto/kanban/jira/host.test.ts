import { expect, it } from "vitest";
import { JiraBoardHost } from "./host.js";
import type { BoardMutationIntent } from "@getpaseo/plugin/otto/kanban";

function fixture() {
  const state = { accountRevision: "account-1", settingsRevision: "settings-1", connected: true };
  const calls: string[] = [];
  const writes: unknown[] = [];
  const binding = { hostId: "host", projectId: "project" };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (init?.method !== "GET") {
      writes.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith("/configuration"))
      return Response.json({
        id: 42,
        name: "Jira",
        columnConfig: { columns: [{ name: "Todo", statuses: [{ id: "1" }] }] },
      });
    if (url.pathname.endsWith("/editmeta"))
      return Response.json({
        fields: {
          summary: {
            name: "Title",
            required: true,
            operations: ["set"],
            schema: { type: "string" },
          },
        },
      });
    if (url.pathname.endsWith("/transitions")) return Response.json({ transitions: [] });
    const issue = {
      id: "100",
      key: "OTTO-1",
      fields: { summary: "Title", updated: "2026-10-24", status: { id: "1" } },
    };
    if (url.pathname.startsWith("/rest/software/"))
      return Response.json({ isLast: true, issues: [issue] });
    return Response.json(issue);
  };
  const host = new JiraBoardHost({
    hostId: "host",
    metadata: {
      read: async () => ({
        projectId: "project",
        rootPath: "/owning/host",
        revision: state.settingsRevision,
        record: { kanban: { adapter: "jira", boardId: "42" } },
      }),
    },
    account: {
      read: async () => ({
        revision: state.accountRevision,
        config: null,
        credential: { stored: state.connected, source: "stored" },
      }),
      resolve: async () =>
        state.connected
          ? {
              revision: state.accountRevision,
              email: "person@example.test",
              apiToken: "fixture-token",
              siteUrl: "https://fixture.atlassian.net",
              route: { kind: "site" },
            }
          : null,
    },
    fetch,
  });
  async function opened() {
    const initial = await host.readBoard(binding);
    if (initial.status !== "ready") throw new Error("Expected fixture board");
    const card = await host.editable(binding, initial.board, initial.settingsRevision, "OTTO-1");
    if (!card.ok) throw new Error(card.error.message);
    return { initial, ...card.value };
  }
  return { host, binding, state, calls, writes, opened };
}
it("composes readable Jira fields and actual edits through the shared host account", async () => {
  const f = fixture();
  expect(f.calls).toEqual([]);
  const card = await f.opened();
  expect(card.snapshot.board.provider).toBe("jira");
  const intent: BoardMutationIntent = {
    binding: f.binding,
    operationId: "operation-00000001",
    boardId: "42",
    expectedBoardRevision: card.snapshot.board.revision,
    expectedSettingsRevision: card.settingsRevision,
    mutation: {
      kind: "edit",
      cardId: "OTTO-1",
      expectedCardRevision: card.snapshot.cardRevisions["OTTO-1"]!,
      fieldId: "summary",
      value: { kind: "text", value: "Changed" },
    },
  };
  expect(await f.host.execute(intent, card.context)).toEqual({ status: "applied" });
  expect(f.writes).toEqual([{ fields: { summary: "Changed" } }]);
});
it("invalidates open board data when the shared account changes", async () => {
  const f = fixture();
  const initial = await f.host.readBoard(f.binding);
  if (initial.status !== "ready") throw new Error("Expected fixture board");
  f.state.accountRevision = "account-2";
  expect(
    await f.host.editable(f.binding, initial.board, initial.settingsRevision, "OTTO-1"),
  ).toMatchObject({ ok: false, error: { code: "revision_conflict" } });
  expect(f.writes).toEqual([]);
});
it("checks account revision again immediately before provider effects", async () => {
  const f = fixture();
  const card = await f.opened();
  f.state.accountRevision = "changed-after-read";
  const intent: BoardMutationIntent = {
    binding: f.binding,
    operationId: "operation-00000001",
    boardId: "42",
    expectedBoardRevision: card.snapshot.board.revision,
    expectedSettingsRevision: card.settingsRevision,
    mutation: {
      kind: "edit",
      cardId: "OTTO-1",
      expectedCardRevision: card.snapshot.cardRevisions["OTTO-1"]!,
      fieldId: "summary",
      value: { kind: "text", value: "Changed" },
    },
  };
  expect(await f.host.execute(intent, card.context)).toMatchObject({
    status: "rejected",
    error: { code: "revision_conflict" },
  });
  expect(f.writes).toEqual([]);
});
it("reports a disconnected account without making a provider request", async () => {
  const f = fixture();
  f.state.connected = false;
  expect(await f.host.readBoard(f.binding)).toMatchObject({
    status: "error",
    error: { code: "auth_required" },
  });
  expect(f.calls).toEqual([]);
});
it("refuses a foreign host before reading a site", async () => {
  const f = fixture();
  expect(await f.host.readBoard({ ...f.binding, hostId: "other" })).toMatchObject({
    status: "error",
    error: { code: "wrong_host" },
  });
  expect(f.calls).toEqual([]);
});
