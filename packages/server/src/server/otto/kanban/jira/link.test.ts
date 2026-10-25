import { expect, it } from "vitest";
import { createAtlassianHttp } from "../../../../services/otto/atlassian/http.js";
import { linkJiraIssue } from "./link.js";
import type { Board } from "@getpaseo/plugin/otto/kanban";

function fixture() {
  const state = {
    backlog: true,
    partial: false,
    wrongKey: false,
    denyRead: false,
    unknownWrite: false,
    visible: true,
    transitionVisible: true,
  };
  const writes: { path: string; body: unknown }[] = [];
  const calls: URL[] = [];
  const issue = {
    id: "100",
    key: "OTTO-1",
    fields: { summary: "Backlog issue", updated: "2026-10-25", status: { id: "1" } },
  };
  const configuration = {
    id: 42,
    name: "Jira",
    columnConfig: {
      columns: [
        { name: "Todo", statuses: [{ id: "1" }] },
        { name: "Done", statuses: [{ id: "2" }] },
      ],
    },
  };
  let linked = false;
  const http = createAtlassianHttp({
    credential: {
      revision: "account",
      email: "fixture@example.test",
      apiToken: "fixture-only",
      siteUrl: "https://fixture.atlassian.net",
      route: { kind: "site" },
    },
    fetch: async (input, init) => {
      const url = new URL(String(input));
      calls.push(url);
      if (init?.method !== "GET") {
        writes.push({ path: url.pathname, body: JSON.parse(String(init?.body)) });
        if (state.unknownWrite) throw new Error("Transport lost after dispatch");
        if (url.pathname.endsWith("/transitions") && state.transitionVisible)
          issue.fields.status.id = "2";
        linked = true;
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith("/configuration")) return Response.json(configuration);
      if (url.pathname.endsWith("/editmeta")) return Response.json({ fields: {} });
      if (url.pathname.endsWith("/transitions"))
        return Response.json({ transitions: [{ id: "finish", to: { id: "2" }, fields: {} }] });
      if (url.pathname === "/rest/api/3/issue/OTTO-1") return Response.json(issue);
      if (url.pathname.endsWith("/backlog")) {
        if (state.denyRead) return new Response(null, { status: 403 });
        return Response.json({
          isLast: !state.partial,
          issues: state.backlog ? [{ ...issue, key: state.wrongKey ? "OTTO-2" : issue.key }] : [],
        });
      }
      return Response.json({ isLast: true, issues: linked && state.visible ? [issue] : [] });
    },
  });
  const board: Board = {
    provider: "jira",
    id: "42",
    title: "Jira",
    url: "https://fixture.atlassian.net/secure/RapidBoard.jspa?rapidView=42",
    revision: "board",
    columns: [
      { id: "Todo", title: "Todo" },
      { id: "Done", title: "Done" },
    ],
    cards: [],
    capabilities: {
      read: true,
      create: false,
      link: true,
      move: false,
      edit: false,
      remove: false,
    },
  };
  const context = { http, board, configuration, siteUrl: "https://fixture.atlassian.net" };
  return { writes, calls, context, state };
}
it("links an exact same-site backlog issue through the official board action and reads membership back", async () => {
  const f = fixture();
  expect(
    await linkJiraIssue(
      { kind: "link", reference: "https://fixture.atlassian.net/browse/OTTO-1", columnId: null },
      f.context,
      async () => ({ ok: true, value: true }),
    ),
  ).toEqual({ status: "applied" });
  expect(f.writes).toEqual([
    { path: "/rest/agile/1.0/board/42/issue", body: { issues: ["OTTO-1"] } },
  ]);
  expect(f.calls[0]!.searchParams.get("jql")).toBe('key = "OTTO-1"');
});
const ready = async () => ({ ok: true as const, value: true as const });
it.each([
  "https://foreign.atlassian.net/browse/OTTO-1",
  "https://user:secret@fixture.atlassian.net/browse/OTTO-1",
  "OTTO-1 OR key=OTTO-2",
  "https://fixture.atlassian.net/browse/OTTO-1?token=secret",
])("refuses foreign or ambiguous references before any request: %s", async (reference) => {
  const f = fixture();
  expect(
    await linkJiraIssue({ kind: "link", reference, columnId: null }, f.context, ready),
  ).toMatchObject({ status: "rejected", error: { code: "invalid_target" } });
  expect(f.calls).toEqual([]);
});
it.each(["backlog", "wrongKey", "partial", "denyRead"] as const)(
  "keeps provider state untouched when exact backlog membership is not established: %s",
  async (condition) => {
    const f = fixture();
    if (condition === "backlog") f.state.backlog = false;
    else f.state[condition] = true;
    expect(
      await linkJiraIssue({ kind: "link", reference: "OTTO-1", columnId: null }, f.context, ready),
    ).toMatchObject({ status: "rejected" });
    expect(f.writes).toEqual([]);
  },
);
it("refuses an existing card without attempting to add it again", async () => {
  const f = fixture();
  f.context.board.cards.push({
    id: "OTTO-1",
    title: "Already here",
    description: "",
    url: null,
    columnId: "Todo",
    kind: "Issue",
    assignees: [],
    archived: false,
  });
  expect(
    await linkJiraIssue({ kind: "link", reference: "OTTO-1", columnId: null }, f.context, ready),
  ).toMatchObject({ status: "rejected", error: { code: "invalid_target" } });
  expect(f.calls).toEqual([]);
});
it("rechecks captured settings and account after the backlog read and before the write", async () => {
  const f = fixture();
  expect(
    await linkJiraIssue(
      { kind: "link", reference: "OTTO-1", columnId: null },
      f.context,
      async () => ({ ok: false, error: { code: "revision_conflict", message: "Changed" } }),
    ),
  ).toMatchObject({ status: "rejected", error: { code: "revision_conflict" } });
  expect(f.writes).toEqual([]);
});
it.each(["unknownWrite", "visible"] as const)(
  "requires reconciliation after an unknown effect or missing read-back: %s",
  async (condition) => {
    const f = fixture();
    if (condition === "visible") f.state.visible = false;
    else f.state.unknownWrite = true;
    expect(
      await linkJiraIssue({ kind: "link", reference: "OTTO-1", columnId: null }, f.context, ready),
    ).toMatchObject({ status: "uncertain" });
    expect(f.writes).toHaveLength(1);
  },
);
it("accepts the requested column only after it is observed in provider truth", async () => {
  const f = fixture();
  expect(
    await linkJiraIssue({ kind: "link", reference: "OTTO-1", columnId: "Todo" }, f.context, ready),
  ).toEqual({ status: "applied" });
  expect(f.writes).toHaveLength(1);
});
it("rejects synthetic or missing columns before reading or writing", async () => {
  const f = fixture();
  expect(
    await linkJiraIssue(
      { kind: "link", reference: "OTTO-1", columnId: "otto:unassigned" },
      f.context,
      ready,
    ),
  ).toMatchObject({ status: "rejected" });
  expect(f.calls).toEqual([]);
});
it("places a linked issue through its actual workflow and checks the requested column afterward", async () => {
  const f = fixture();
  expect(
    await linkJiraIssue({ kind: "link", reference: "OTTO-1", columnId: "Done" }, f.context, ready),
  ).toEqual({ status: "applied" });
  expect(f.writes).toEqual([
    { path: "/rest/agile/1.0/board/42/issue", body: { issues: ["OTTO-1"] } },
    { path: "/rest/api/3/issue/OTTO-1/transitions", body: { transition: { id: "finish" } } },
  ]);
});
it("does not claim full placement if a successful workflow response is not reflected in the board", async () => {
  const f = fixture();
  f.state.transitionVisible = false;
  expect(
    await linkJiraIssue({ kind: "link", reference: "OTTO-1", columnId: "Done" }, f.context, ready),
  ).toMatchObject({ status: "uncertain" });
  expect(f.writes).toHaveLength(2);
});
it("keeps the accepted link and requires reconciliation if ownership changes before placement", async () => {
  const f = fixture();
  let checks = 0;
  expect(
    await linkJiraIssue(
      { kind: "link", reference: "OTTO-1", columnId: "Done" },
      f.context,
      async () =>
        ++checks === 1
          ? { ok: true, value: true }
          : { ok: false, error: { code: "revision_conflict", message: "Changed" } },
    ),
  ).toMatchObject({ status: "uncertain" });
  expect(f.writes).toEqual([
    { path: "/rest/agile/1.0/board/42/issue", body: { issues: ["OTTO-1"] } },
  ]);
});
