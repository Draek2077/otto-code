import { expect, it } from "vitest";
import { createAtlassianHttp } from "../../../../services/otto/atlassian/http.js";
import { readJiraCreation } from "./creation-metadata.js";
import { createJiraIssue } from "./create.js";
import type { JiraBoardActionContext } from "./link.js";
import type { BoardMutation } from "@getpaseo/plugin/otto/kanban";
import type { JiraEditField } from "./fields.js";

function fixture() {
  const state = {
    extraRequired: false,
    extraDefault: false,
    partial: false,
    repeated: false,
    deny: false,
    unknown: false,
    visible: true,
    identity: true,
  };
  const requests: { method: string; path: string; body?: unknown }[] = [];
  const fields: Array<JiraEditField & { fieldId: string; required: boolean }> = [
    {
      fieldId: "summary",
      name: "Title",
      required: true,
      schema: { type: "string" },
      operations: ["set"],
    },
    {
      fieldId: "description",
      name: "Description",
      required: false,
      schema: { type: "string" },
      operations: ["set"],
    },
  ];
  const config = {
    id: 42,
    name: "Jira",
    columnConfig: { columns: [{ name: "Todo", statuses: [{ id: "1" }] }] },
  };
  let created = false;
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
      const method = init?.method ?? "GET";
      requests.push({
        method,
        path: url.pathname,
        ...(method !== "GET" ? { body: JSON.parse(String(init?.body)) } : {}),
      });
      if (method !== "GET") {
        created = true;
        if (state.unknown) throw new Error("Lost response");
        return Response.json(state.identity ? { id: "100", key: "OTTO-1" } : {});
      }
      if (state.deny) return new Response(null, { status: 403 });
      if (url.pathname.endsWith("/project"))
        return Response.json({
          startAt: 0,
          total: state.partial ? 2 : 1,
          values: [{ id: "10", key: "OTTO", name: "Otto" }],
        });
      if (url.pathname.endsWith("/issuetypes"))
        return Response.json({
          startAt: 0,
          total: 2,
          issueTypes: [
            { id: "20", name: "Task", subtask: false },
            { id: "21", name: "Subtask", subtask: true },
          ],
        });
      if (url.pathname.endsWith("/issuetypes/20")) {
        const rows = [...fields];
        if (state.extraRequired)
          rows.push({
            fieldId: "customfield_1",
            name: "Approval",
            required: true,
            schema: { type: "string" },
            operations: ["set"],
            hasDefaultValue: state.extraDefault,
          });
        if (state.repeated) rows.push(fields[0]!);
        return Response.json({ startAt: 0, total: rows.length, fields: rows });
      }
      if (url.pathname.endsWith("/configuration")) return Response.json(config);
      return Response.json({
        isLast: true,
        issues:
          created && state.visible
            ? [
                {
                  id: "100",
                  key: "OTTO-1",
                  fields: { summary: "New", updated: "now", status: { id: "1" } },
                },
              ]
            : [],
      });
    },
  });
  const context: JiraBoardActionContext = {
    http,
    configuration: config,
    siteUrl: "https://fixture.atlassian.net",
    board: {
      provider: "jira",
      id: "42",
      title: "Jira",
      url: null,
      revision: "board",
      columns: [{ id: "Todo", title: "Todo" }],
      cards: [],
      capabilities: {
        read: true,
        create: true,
        link: true,
        edit: false,
        move: false,
        remove: false,
      },
    },
  };
  const selection = { projectId: "10", issueTypeId: "20" };
  async function mutation(): Promise<Extract<BoardMutation, { kind: "create" }>> {
    const metadata = await readJiraCreation(context, selection);
    if (!metadata.ok || !metadata.value.options.revision) throw new Error("Expected metadata");
    return {
      kind: "create",
      title: "New",
      description: "First\nSecond",
      columnId: null,
      jira: { ...selection, expectedCreateRevision: metadata.value.options.revision },
    };
  }
  return { state, requests, context, selection, mutation };
}
const ready = async () => ({ ok: true as const, value: true as const });
it("discovers explicit board projects and non-subtask issue types without writing", async () => {
  const f = fixture();
  expect(await readJiraCreation(f.context, {})).toMatchObject({
    ok: true,
    value: {
      options: { projects: [{ id: "10", label: "OTTO: Otto" }], issueTypes: [], available: false },
    },
  });
  expect(await readJiraCreation(f.context, { projectId: "10" })).toMatchObject({
    ok: true,
    value: { options: { issueTypes: [{ id: "20", label: "Task" }] } },
  });
  expect(f.requests.every((row) => row.method === "GET")).toBe(true);
});
it("creates with exact metadata identities and ADF, then verifies board membership", async () => {
  const f = fixture();
  expect(await createJiraIssue(await f.mutation(), f.context, ready)).toEqual({
    status: "applied",
  });
  expect(f.requests.filter((row) => row.method !== "GET")).toEqual([
    {
      method: "POST",
      path: "/rest/api/3/issue",
      body: {
        fields: {
          project: { id: "10" },
          issuetype: { id: "20" },
          summary: "New",
          description: {
            type: "doc",
            version: 1,
            content: [
              { type: "paragraph", content: [{ type: "text", text: "First" }] },
              { type: "paragraph", content: [{ type: "text", text: "Second" }] },
            ],
          },
        },
      },
    },
  ]);
});
it("refuses changed creation metadata before sending any mutation", async () => {
  const f = fixture();
  const mutation = await f.mutation();
  f.state.extraRequired = true;
  expect(await createJiraIssue(mutation, f.context, ready)).toMatchObject({
    status: "rejected",
    error: { code: "revision_conflict" },
  });
  expect(f.requests.every((row) => row.method === "GET")).toBe(true);
});
it("discloses unsupported required fields without inventing values", async () => {
  const f = fixture();
  f.state.extraRequired = true;
  expect(await readJiraCreation(f.context, f.selection)).toMatchObject({
    ok: true,
    value: { options: { available: false, message: expect.stringContaining("Approval") } },
  });
  expect(await createJiraIssue(await f.mutation(), f.context, ready)).toMatchObject({
    status: "rejected",
  });
  expect(f.requests.every((row) => row.method === "GET")).toBe(true);
});
it("retains required host defaults without manufacturing or sending them", async () => {
  const f = fixture();
  f.state.extraRequired = true;
  f.state.extraDefault = true;
  expect(await createJiraIssue(await f.mutation(), f.context, ready)).toEqual({
    status: "applied",
  });
  const write = f.requests.find((row) => row.method === "POST");
  expect(write?.body).not.toHaveProperty("fields.customfield_1");
});
it.each(["partial", "repeated", "deny"] as const)(
  "rejects incomplete or denied creation discovery: %s",
  async (condition) => {
    const f = fixture();
    f.state[condition] = true;
    expect(await readJiraCreation(f.context, f.selection)).toMatchObject({ ok: false });
    expect(f.requests.every((row) => row.method === "GET")).toBe(true);
  },
);
it.each([{ projectId: "foreign" }, { projectId: "10", issueTypeId: "21" }])(
  "refuses a project/type that was not offered: %j",
  async (selection) => {
    const f = fixture();
    expect(await readJiraCreation(f.context, selection)).toMatchObject({
      ok: false,
      error: { code: "invalid_target" },
    });
  },
);
it("checks owner authority again after metadata and before creation", async () => {
  const f = fixture();
  expect(
    await createJiraIssue(await f.mutation(), f.context, async () => ({
      ok: false,
      error: { code: "revision_conflict", message: "Changed" },
    })),
  ).toMatchObject({ status: "rejected" });
  expect(f.requests.every((row) => row.method === "GET")).toBe(true);
});
it.each(["unknown", "visible", "identity"] as const)(
  "requires reconciliation without repeating a possibly applied creation: %s",
  async (condition) => {
    const f = fixture();
    const mutation = await f.mutation();
    if (condition === "unknown") f.state.unknown = true;
    else f.state[condition] = false;
    expect(await createJiraIssue(mutation, f.context, ready)).toMatchObject({
      status: "uncertain",
    });
    expect(f.requests.filter((row) => row.method === "POST")).toHaveLength(1);
  },
);
