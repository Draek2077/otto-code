import { expect, it } from "vitest";
import { createAtlassianHttp } from "../../../../services/otto/atlassian/http.js";
import { readJiraBoard } from "./reader.js";
import { jiraDescription, jiraDocument } from "./adf.js";

function fixture() {
  const state = { repeat: false, changeConfig: false, invalidIssue: false, failPage: false };
  const calls: string[] = [];
  let configurations = 0;
  const configuration = {
    id: 42,
    name: "Fixture Jira",
    location: { id: "project", key: "OTTO", type: "project" },
    columnConfig: {
      columns: [
        { name: "Todo", statuses: [{ id: "1" }, { id: "2" }] },
        { name: "Done", statuses: [{ id: "3" }] },
      ],
    },
  };
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    if (url.pathname.endsWith("/configuration")) {
      configurations++;
      return Response.json({
        ...configuration,
        name: state.changeConfig && configurations > 1 ? "Changed" : configuration.name,
      });
    }
    const second = url.searchParams.has("nextPageToken");
    if (second && state.failPage) return new Response("Denied", { status: 403 });
    const number = second ? 2 : 1;
    let status = second ? "3" : "2";
    if (state.invalidIssue) status = "unknown";
    return Response.json({
      isLast: second && !state.repeat,
      ...(second && !state.repeat ? {} : { nextPageToken: "next-page" }),
      issues: [
        {
          id: String(number),
          key: "OTTO-" + number,
          fields: {
            summary: "Card " + number,
            updated: "2026-10-24T12:00:00Z",
            description: {
              type: "doc",
              version: 1,
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Rich description" }] },
              ],
            },
            status: { id: status },
            assignee: { displayName: "Fixture User" },
          },
        },
      ],
    });
  };
  const http = createAtlassianHttp({
    credential: {
      email: "fixture@example.test",
      apiToken: "fixture-secret",
      revision: "account-1",
      siteUrl: "https://fixture.atlassian.net",
      route: { kind: "site" },
    },
    fetch,
  });
  return {
    state,
    calls,
    read: () => readJiraBoard({ http, boardId: "42", siteUrl: "https://fixture.atlassian.net" }),
  };
}
it("reads all enhanced pages and maps real status columns rather than quick filters", async () => {
  const f = fixture();
  const result = await f.read();
  expect(result).toMatchObject({
    ok: true,
    value: {
      board: {
        provider: "jira",
        id: "42",
        title: "Fixture Jira",
        columns: [
          { id: "Todo", title: "Todo" },
          { id: "Done", title: "Done" },
          { id: "otto:unassigned", title: "Unassigned" },
        ],
        cards: [
          {
            id: "OTTO-1",
            title: "Card 1",
            description: "Rich description",
            columnId: "Todo",
            url: "https://fixture.atlassian.net/browse/OTTO-1",
          },
          { id: "OTTO-2", columnId: "Done" },
        ],
      },
    },
  });
  expect(f.calls.filter((url) => url.includes("/rest/software/1.0/board/42/issue"))).toHaveLength(
    2,
  );
  expect(f.calls[2]).toContain("nextPageToken=next-page");
  expect(f.calls.every((url) => !url.includes("quickfilter"))).toBe(true);
});
it("does not claim a complete board after a denied later page", async () => {
  const f = fixture();
  f.state.failPage = true;
  expect(await f.read()).toMatchObject({ ok: false, error: { code: "access_denied" } });
});
it("rejects repeated issue identities and changing board configuration", async () => {
  const f = fixture();
  f.state.repeat = true;
  expect(await f.read()).toMatchObject({ ok: false, error: { code: "invalid_response" } });
  const changed = fixture();
  changed.state.changeConfig = true;
  expect(await changed.read()).toMatchObject({ ok: false, error: { code: "revision_conflict" } });
});
it("shows newly unmapped statuses as unassigned without inventing a writable transition", async () => {
  const f = fixture();
  f.state.invalidIssue = true;
  const result = await f.read();
  expect(result).toMatchObject({
    ok: true,
    value: {
      board: {
        cards: [{ columnId: "otto:unassigned" }, { columnId: "otto:unassigned" }],
        capabilities: { move: false, remove: false },
      },
    },
  });
});
it("supports legacy text and bounded structured descriptions without changing them on read", () => {
  expect(jiraDescription("Plain description")).toEqual({ ok: true, value: "Plain description" });
  const document = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "One" },
          { type: "hardBreak" },
          { type: "text", text: "Two" },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "Three" }] },
    ],
  };
  const bytes = JSON.stringify(document);
  expect(jiraDescription(document)).toEqual({ ok: true, value: "One\nTwo\nThree" });
  expect(JSON.stringify(document)).toBe(bytes);
  expect(jiraDocument("One\nTwo")).toEqual({
    version: 1,
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "One" }] },
      { type: "paragraph", content: [{ type: "text", text: "Two" }] },
    ],
  });
  expect(jiraDocument("")).toBeNull();
});
it("rejects excessive description depth instead of recursing or silently truncating", () => {
  let document: unknown = { type: "text", text: "Deep" };
  for (let depth = 0; depth < 66; depth++) document = { type: "paragraph", content: [document] };
  expect(jiraDescription(document)).toMatchObject({ ok: false, error: { code: "read_limit" } });
});
