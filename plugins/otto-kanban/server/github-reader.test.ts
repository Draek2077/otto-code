import { describe, expect, it } from "vitest";
import { createGitHubReader } from "./github-reader.js";
import { UNASSIGNED_COLUMN } from "./github-board.js";
import {
  discoverRepositoryDocument,
  readFieldsDocument,
  readItemsDocument,
  resolveNumberDocument,
} from "./github-documents.js";
import {
  binding,
  fieldsFixture,
  header,
  itemFixture,
  itemsFixture,
  page,
  fieldLimitPageFixture,
  itemLimitPageFixture,
} from "./github-fixtures.js";
import { BoardSchema, failure, type Result } from "../shared/model.js";
import type { GitHubReadPort } from "./ports.js";

function fixture(responses: unknown[]) {
  const calls: Parameters<GitHubReadPort["query"]>[0][] = [];
  const reader = createGitHubReader({
    hostId: "host-a",
    query: async (input) => {
      calls.push(input);
      if (!responses.length) throw new Error("Unexpected extra request");
      return { ok: true, value: responses.shift() };
    },
  });
  return { reader, calls };
}
const input = { binding, target: { kind: "node" as const, id: "PVT_board" } };

describe("official GitHub Projects v2 read adapter", () => {
  it("does nothing at construction and normalizes issues, PRs and drafts without write capabilities", async () => {
    const f = fixture([fieldsFixture(), itemsFixture()]);
    expect(f.calls).toEqual([]);
    const result = await f.reader.read(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(BoardSchema.parse(result.value)).toEqual({
      provider: "github",
      id: "PVT_board",
      title: "Shared project",
      url: "https://github.com/orgs/shared/projects/7",
      revision: header.updatedAt,
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
        { id: UNASSIGNED_COLUMN, title: "Unassigned" },
      ],
      cards: ["Issue", "PullRequest", "DraftIssue"].map((kind, index) => ({
        id: ["issue", "pr", "draft"][index],
        title: `${kind} title`,
        description: "Description",
        url: kind === "DraftIssue" ? null : "https://github.com/shared/repo/issues/1",
        columnId: "todo",
        kind,
        archived: false,
        assignees: ["person"],
      })),
    });
    expect(f.calls).toEqual([
      { binding, document: readFieldsDocument, variables: { id: "PVT_board", cursor: null } },
      {
        binding,
        document: readItemsDocument,
        variables: { id: "PVT_board", cursor: null, statusName: "Status" },
      },
    ]);
  });

  it("resolves the configured owner and number, never the first accessible account board", async () => {
    const f = fixture([
      { data: { repositoryOwner: { projectV2: { id: "PVT_board" } } } },
      fieldsFixture(),
      itemsFixture(),
    ]);
    expect(
      await f.reader.read({ binding, target: { kind: "number", owner: "shared", number: 7 } }),
    ).toMatchObject({ ok: true });
    expect(f.calls[0]).toEqual({
      binding,
      document: resolveNumberDocument,
      variables: { owner: "shared", number: 7 },
    });
  });

  it("requires an explicit choice for ambiguous repository discovery", async () => {
    const f = fixture([
      {
        data: {
          repository: { projectsV2: { nodes: [{ id: "first" }, { id: "second" }], totalCount: 2 } },
        },
      },
    ]);
    expect(
      await f.reader.read({
        binding,
        target: { kind: "repository", owner: "shared", repository: "repo" },
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_target" } });
    expect(f.calls).toEqual([
      {
        binding,
        document: discoverRepositoryDocument,
        variables: { owner: "shared", repository: "repo" },
      },
    ]);
  });

  it("discovers a single repository board and reports no linked board explicitly", async () => {
    const target = { kind: "repository" as const, owner: "shared", repository: "repo" };
    const found = fixture([
      { data: { repository: { projectsV2: { nodes: [{ id: "PVT_board" }], totalCount: 1 } } } },
      fieldsFixture(),
      itemsFixture(),
    ]);
    expect(await found.reader.read({ binding, target })).toMatchObject({ ok: true });
    const missing = fixture([
      { data: { repository: { projectsV2: { nodes: [], totalCount: 0 } } } },
    ]);
    expect(await missing.reader.read({ binding, target })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });

  it("pages fields and items using separate cursors", async () => {
    const firstFields = fieldsFixture();
    firstFields.data.node.fields.nodes = firstFields.data.node.fields.nodes.slice(0, 1);
    const fieldPage = {
      ...firstFields.data.node.fields,
      pageInfo: { hasNextPage: true, endCursor: "fields-next" },
    };
    const secondFields = fieldsFixture();
    secondFields.data.node.fields.nodes = secondFields.data.node.fields.nodes.slice(1);
    const firstItems = itemsFixture();
    firstItems.data.node.items.nodes = [itemFixture("Issue", "one")];
    const itemPage = {
      ...firstItems.data.node.items,
      pageInfo: { hasNextPage: true, endCursor: "items-next" },
    };
    const secondItems = itemsFixture();
    secondItems.data.node.items.nodes = [itemFixture("DraftIssue", "two")];
    const f = fixture([
      { data: { node: { ...firstFields.data.node, fields: fieldPage } } },
      secondFields,
      { data: { node: { ...firstItems.data.node, items: itemPage } } },
      secondItems,
    ]);
    expect(await f.reader.read(input)).toMatchObject({
      ok: true,
      value: { cards: [{ id: "one" }, { id: "two" }] },
    });
    expect(f.calls.map((call) => call.variables.cursor)).toEqual([
      null,
      "fields-next",
      null,
      "items-next",
    ]);
  });

  it("retains restricted items, missing status and archived state without inventing content", async () => {
    const items = itemsFixture();
    const restricted = {
      ...itemFixture(),
      content: null,
      fieldValueByName: null,
      isArchived: true,
    };
    const f = fixture([
      fieldsFixture(),
      { data: { node: { ...items.data.node, items: { nodes: [restricted], pageInfo: page } } } },
    ]);
    expect(await f.reader.read(input)).toMatchObject({
      ok: true,
      value: {
        cards: [
          {
            id: "item-1",
            title: "Unavailable item",
            kind: "unavailable",
            description: "",
            url: null,
            assignees: [],
            archived: true,
            columnId: UNASSIGNED_COLUMN,
          },
        ],
      },
    });
  });

  it("never uses Priority as Status and supports a board without a status field", async () => {
    const fields = fieldsFixture();
    fields.data.node.fields.nodes = fields.data.node.fields.nodes.filter(
      (field) => field.id !== "status",
    );
    const f = fixture([fields, itemsFixture()]);
    expect(await f.reader.read(input)).toMatchObject({
      ok: true,
      value: {
        columns: [{ id: UNASSIGNED_COLUMN }],
        cards: [
          { columnId: UNASSIGNED_COLUMN },
          { columnId: UNASSIGNED_COLUMN },
          { columnId: UNASSIGNED_COLUMN },
        ],
      },
    });
  });

  it("refuses truncated nested connections instead of returning a partial board", async () => {
    const items = itemsFixture();
    items.data.node.items.nodes[0]!.content.assignees.pageInfo.hasNextPage = true;
    const f = fixture([fieldsFixture(), items]);
    expect(await f.reader.read(input)).toMatchObject({ ok: false, error: { code: "read_limit" } });
  });

  it("stops at the field limit without returning a partial board", async () => {
    const responses = Array.from({ length: 5 }, (_entry, index) => fieldLimitPageFixture(index));
    const f = fixture(responses);
    expect(await f.reader.read(input)).toMatchObject({ ok: false, error: { code: "read_limit" } });
    expect(f.calls).toHaveLength(5);
  });

  it("stops at the item limit without returning a partial board", async () => {
    const pages = Array.from({ length: 20 }, (_entry, index) => itemLimitPageFixture(index));
    const f = fixture([fieldsFixture(), ...pages]);
    expect(await f.reader.read(input)).toMatchObject({ ok: false, error: { code: "read_limit" } });
    expect(f.calls).toHaveLength(21);
  });

  it("detects a changed board, wrong node, invalid field union and malformed page", async () => {
    const changed = itemsFixture();
    changed.data.node.updatedAt = "new-revision";
    expect(await fixture([fieldsFixture(), changed]).reader.read(input)).toMatchObject({
      ok: false,
      error: { code: "unavailable" },
    });
    const wrong = fieldsFixture();
    wrong.data.node.id = "other-board";
    expect(await fixture([wrong]).reader.read(input)).toMatchObject({
      ok: false,
      error: { code: "invalid_response" },
    });
    const invented = fieldsFixture();
    const inventedNode = {
      ...invented.data.node,
      fields: {
        ...invented.data.node.fields,
        nodes: [
          {
            __typename: "ProjectV2FieldSingleSelect",
            id: "status",
            name: "Status",
            options: { nodes: [] },
          },
        ],
      },
    };
    expect(await fixture([{ data: { node: inventedNode } }]).reader.read(input)).toMatchObject({
      ok: false,
      error: { code: "invalid_response" },
    });
    expect(
      await fixture([
        {
          data: {
            node: {
              ...fieldsFixture().data.node,
              fields: { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } },
            },
          },
        },
      ]).reader.read(input),
    ).toMatchObject({ ok: false, error: { code: "invalid_response" } });
  });

  it("rejects wrong field membership and repeated pagination cursors", async () => {
    const items = itemsFixture();
    items.data.node.items.nodes[0]!.fieldValueByName.field.id = "priority";
    expect(await fixture([fieldsFixture(), items]).reader.read(input)).toMatchObject({
      ok: false,
      error: { code: "invalid_response" },
    });
    const one = {
      data: {
        node: {
          ...header,
          items: {
            nodes: [itemFixture("Issue", "one")],
            pageInfo: { hasNextPage: true, endCursor: "repeated" },
          },
        },
      },
    };
    const two = {
      data: {
        node: {
          ...header,
          items: {
            nodes: [itemFixture("Issue", "two")],
            pageInfo: { hasNextPage: true, endCursor: "repeated" },
          },
        },
      },
    };
    expect(await fixture([fieldsFixture(), one, two]).reader.read(input)).toMatchObject({
      ok: false,
      error: { code: "invalid_response" },
    });
  });

  it("rejects all GraphQL partial data and classifies safe errors", async () => {
    for (const [type, code] of [
      ["RATE_LIMITED", "rate_limited"],
      ["INSUFFICIENT_SCOPES", "scope_required"],
      ["FORBIDDEN", "access_denied"],
      ["NOT_FOUND", "not_found"],
      ["OTHER", "unavailable"],
    ]) {
      const f = fixture([{ ...fieldsFixture(), errors: [{ type, message: "vendor secret" }] }]);
      const result = await f.reader.read(input);
      expect(result).toMatchObject({ ok: false, error: { code } });
      expect(JSON.stringify(result)).not.toContain("vendor secret");
      expect(f.calls).toHaveLength(1);
    }
  });

  it("propagates typed gh auth/scopes errors and hides unexpected exceptions", async () => {
    for (const code of ["auth_required", "scope_required"] as const) {
      const result: Result<never> = failure(code, "Safe host diagnostic");
      expect(
        await createGitHubReader({ hostId: "host-a", query: async () => result }).read(input),
      ).toEqual(result);
    }
    expect(
      await createGitHubReader({
        hostId: "host-a",
        query: async () => {
          throw new Error("token secret");
        },
      }).read(input),
    ).toEqual(failure("unavailable", "The owning host could not read GitHub. Retry later."));
  });

  it("rejects a different host before requesting vendor data", async () => {
    const f = fixture([]);
    expect(
      await f.reader.read({ ...input, binding: { ...binding, hostId: "host-b" } }),
    ).toMatchObject({ ok: false, error: { code: "wrong_host" } });
    expect(f.calls).toEqual([]);
  });

  it("keeps emitted documents read-only and uses the official field/content shapes", () => {
    for (const document of [
      resolveNumberDocument,
      discoverRepositoryDocument,
      readFieldsDocument,
      readItemsDocument,
    ]) {
      expect(document).toMatch(/^query OttoKanban/);
      expect(document).not.toMatch(/\bmutation\b/);
    }
    expect(readFieldsDocument).toContain("... on ProjectV2FieldCommon { id name }");
    expect(readFieldsDocument).toContain(
      "... on ProjectV2SingleSelectField { options { id name } }",
    );
    expect(readItemsDocument).toContain("fieldValueByName(name: $statusName)");
    expect(readItemsDocument).toContain("... on DraftIssue { title body assignees");
    expect(readItemsDocument).toContain("content {\n            __typename");
  });
});
