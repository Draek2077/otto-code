import { describe, expect, it } from "vitest";
import type { KanbanBoard } from "@otto-code/protocol/kanban";
import { KANBAN_REMEDIATION_GITHUB_SCOPES } from "@otto-code/protocol/kanban";
import { GITHUB_UNASSIGNED_COLUMN_ID, GitHubProjectV2Provider } from "./github-provider.js";
import { KanbanRemediationError } from "./kanban-remediation.js";

/**
 * Fixtures here are the *real* Projects v2 response shapes, captured against
 * the live schema. That distinction is load-bearing: an earlier version of this
 * suite invented the shapes (`ProjectV2FieldSingleSelect`, `options { nodes }`,
 * `addProjectV2ItemToProject`) and passed green while every document the
 * provider sent was rejected by GitHub before it executed. A fixture that does
 * not match the schema tests nothing, so the three traps that made that
 * possible are asserted directly in "the documents GitHub actually accepts".
 */

interface ItemsPage {
  nodes: unknown[];
  pageInfo?: { hasNextPage: boolean; endCursor: string | null };
}

interface StubOptions {
  token?: string | null;
  viewerProjects?: { id: string; title: string; url?: string }[];
  configuredBoard?: { id: string; title: string; url?: string } | null;
  configuredNode?: { __typename: string; id?: string; title?: string } | null;
  layout?: unknown;
  /** One entry per item page, served in order; the last page repeats. */
  itemPages?: ItemsPage[];
  resolveTask?: unknown;
}

/** What `addProjectV2DraftIssue` answers with: a draft issue has no URL. */
const CREATED_DRAFT_ITEM = {
  id: "item-new",
  content: {
    __typename: "DraftIssue",
    title: "Drafted",
    bodyText: "notes",
    assignees: { nodes: [] },
  },
};

const LINKED_ISSUE_ITEM = {
  id: "item-linked",
  content: {
    __typename: "Issue",
    title: "Existing work",
    url: "https://github.com/acme/widgets/issues/7",
    bodyText: "",
    assignees: { nodes: [] },
  },
};

function configuredNodeOf(options: StubOptions): unknown {
  if (options.configuredNode !== undefined) {
    return options.configuredNode;
  }
  return options.configuredBoard ? { __typename: "ProjectV2", ...options.configuredBoard } : null;
}

function itemsPageOf(options: StubOptions, state: { itemPageIndex: number }): unknown {
  const pages = options.itemPages ?? [];
  const page = pages[state.itemPageIndex] ?? pages[pages.length - 1];
  state.itemPageIndex = Math.min(state.itemPageIndex + 1, pages.length);
  if (!page) {
    return { node: null };
  }
  return {
    node: {
      __typename: "ProjectV2",
      items: {
        pageInfo: page.pageInfo ?? { hasNextPage: false, endCursor: null },
        nodes: page.nodes,
      },
    },
  };
}

/**
 * The stub's routing table, matched in order: "query KanbanViewerProjects" has
 * to be tried before the "query KanbanViewer" login probe, which prefixes it.
 */
function stubRoutes(
  options: StubOptions,
  state: { itemPageIndex: number },
): Array<[string, () => unknown]> {
  return [
    [
      "query KanbanViewerProjects",
      () => ({ viewer: { projectsV2: { nodes: options.viewerProjects ?? [] } } }),
    ],
    [
      "query KanbanProjectByNumber",
      () => ({ organization: { projectV2: options.configuredBoard ?? null }, user: null }),
    ],
    ["query KanbanProjectByNode", () => ({ node: configuredNodeOf(options) })],
    ["query KanbanViewer", () => ({ viewer: { login: "octocat" } })],
    ["query KanbanBoardLayout", () => ({ node: options.layout ?? null })],
    ["query KanbanBoardItems", () => itemsPageOf(options, state)],
    [
      "query KanbanResolveTask",
      () => options.resolveTask ?? { repository: { issue: null, pullRequest: null } },
    ],
    [
      "mutation KanbanCreateCard",
      () => ({ addProjectV2DraftIssue: { projectItem: CREATED_DRAFT_ITEM } }),
    ],
    ["mutation KanbanLinkTask", () => ({ addProjectV2ItemById: { item: LINKED_ISSUE_ITEM } })],
    ["mutation KanbanSetCardStatus", () => ({ ok: true })],
    ["mutation KanbanClearCardStatus", () => ({ ok: true })],
  ];
}

/**
 * Builds a fetch stub that routes on the GraphQL document in the request body.
 * Returns the captured calls plus the provider.
 */
function makeProvider(options: StubOptions) {
  const calls: Array<{ url: string; query: string; variables: Record<string, unknown> }> = [];
  const routes = stubRoutes(options, { itemPageIndex: 0 });
  const fetchImpl: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      query: string;
      variables: Record<string, unknown>;
    };
    calls.push({ url: String(input), query: body.query, variables: body.variables });
    const route = routes.find(([prefix]) => body.query.startsWith(prefix));
    return new Response(JSON.stringify({ data: route ? route[1]() : {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { calls, provider: new GitHubProjectV2Provider({ fetch: fetchImpl }) };
}

function cardIdsOf(board: KanbanBoard): string[] {
  return board.columns.flatMap((column) => column.cards.map((card) => card.id));
}

/**
 * A ProjectV2 layout as GitHub really answers it: `fields` is a connection over
 * the ProjectV2FieldConfiguration union, the single-select type is
 * `ProjectV2SingleSelectField`, and its `options` is a plain list.
 *
 * Two single-selects, because one is not enough to catch a provider that binds
 * card status to whichever value arrives first rather than to the status field.
 */
function makeLayoutNode() {
  return {
    __typename: "ProjectV2",
    title: "Engineering Board",
    fields: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [
        { __typename: "ProjectV2Field", id: "field-text", name: "Notes" },
        {
          __typename: "ProjectV2SingleSelectField",
          id: "field-priority",
          name: "Priority",
          options: [
            { id: "opt-high", name: "High" },
            { id: "opt-low", name: "Low" },
          ],
        },
        {
          __typename: "ProjectV2SingleSelectField",
          id: "field-status",
          name: "Status",
          options: [
            { id: "opt-todo", name: "To Do" },
            { id: "opt-done", name: "Done" },
          ],
        },
      ],
    },
  };
}

/** Item rows: a placed issue, an unplaced pull request, and a draft issue. */
function makeItemNodes() {
  return [
    {
      id: "item-1",
      content: {
        __typename: "Issue",
        title: "Fix the bug",
        url: "https://github.com/acme/widgets/issues/1",
        bodyText: "body",
        assignees: { nodes: [{ login: "alice" }] },
      },
      fieldValues: {
        nodes: [
          // Priority comes first on the wire: only the field id makes this
          // distinguishable from the status value.
          {
            __typename: "ProjectV2ItemFieldSingleSelectValue",
            optionId: "opt-high",
            field: { id: "field-priority" },
          },
          {
            __typename: "ProjectV2ItemFieldSingleSelectValue",
            optionId: "opt-todo",
            field: { id: "field-status" },
          },
        ],
      },
    },
    {
      id: "item-2",
      content: {
        __typename: "PullRequest",
        title: "Refactor",
        url: "https://github.com/acme/widgets/pull/2",
        bodyText: "",
        assignees: { nodes: [] },
      },
      fieldValues: { nodes: [{ __typename: "ProjectV2ItemFieldTextValue" }] },
    },
    {
      id: "item-3",
      content: {
        __typename: "DraftIssue",
        title: "Think about caching",
        bodyText: "",
        assignees: { nodes: [] },
      },
      fieldValues: {
        nodes: [
          {
            __typename: "ProjectV2ItemFieldSingleSelectValue",
            optionId: "opt-done",
            field: { id: "field-status" },
          },
        ],
      },
    },
  ];
}

function makeBoardProvider(token = "ghp_test") {
  return makeProvider({
    token,
    layout: makeLayoutNode(),
    itemPages: [{ nodes: makeItemNodes() }],
  });
}

/**
 * A provider whose board reads fail the way GitHub really fails them: the same
 * insufficient-scope complaint repeated once per requested field, each one
 * signed off with the personal access token settings link. The viewer probe in
 * `initialize` succeeds, because `viewer { login }` needs no extra scope.
 */
function makeScopeFailureProvider(
  options: {
    message?: string;
    type?: string;
    grantedHeader?: string;
    apiBaseUrl?: string;
  } = {},
) {
  const fields = ["id", "title", "url"];
  const message =
    options.message ??
    fields
      .map(
        (field) =>
          "Your token has not been granted the required scopes to execute this query. " +
          `The '${field}' field requires one of the following scopes: ['read:project'], ` +
          "but your token has only been granted the: ['gist', 'read:org', 'repo', 'workflow'] " +
          "scopes. Please modify your token's scopes at: https://github.com/settings/tokens.",
      )
      .join(" ");
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { query: string };
    if (body.query.startsWith("query KanbanViewer ")) {
      return new Response(JSON.stringify({ data: { viewer: { login: "octocat" } } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        errors: [{ message, type: options.type ?? "INSUFFICIENT_SCOPES" }],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...(options.grantedHeader ? { "X-OAuth-Scopes": options.grantedHeader } : {}),
        },
      },
    );
  };
  return new GitHubProjectV2Provider({
    fetch: fetchImpl,
    ...(options.apiBaseUrl ? { apiBaseUrl: options.apiBaseUrl } : {}),
  });
}

describe("GitHubProjectV2Provider", () => {
  it("lists the viewer's projects", async () => {
    const { provider } = makeProvider({
      token: "ghp_test",
      viewerProjects: [{ id: "PVT_1", title: "Board A" }],
    });
    await provider.initialize({ githubToken: "ghp_test" });
    const boards = await provider.listBoards({});
    expect(boards).toEqual([{ providerId: "github", boardId: "PVT_1", title: "Board A" }]);
  });

  it("resolves a configured board number against its GitHub owner", async () => {
    const { provider, calls } = makeProvider({
      token: "ghp_test",
      configuredBoard: { id: "PVT_configured", title: "Release board" },
    });
    await provider.initialize({ githubToken: "ghp_test" });

    const boards = await provider.listBoards({ targetBoardId: "12", targetBoardOwner: "acme" });

    expect(boards).toEqual([
      { providerId: "github", boardId: "PVT_configured", title: "Release board" },
    ]);
    const call = calls.find((entry) => entry.query.startsWith("query KanbanProjectByNumber"));
    expect(call?.variables).toEqual({ login: "acme", number: 12 });
  });

  it("resolves an organization board despite GitHub's NOT_FOUND for the user half", async () => {
    // What GitHub really returns for an organization login: the board under
    // `organization`, plus a NOT_FOUND error for `user` with the same login.
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { query: string };
      const payload = body.query.startsWith("query KanbanProjectByNumber")
        ? {
            data: {
              organization: { projectV2: { id: "PVT_org", title: "Org board" } },
              user: null,
            },
            errors: [
              {
                type: "NOT_FOUND",
                path: ["user"],
                message: "Could not resolve to a User with the login of 'taste-the-city'.",
              },
            ],
          }
        : { data: { viewer: { login: "octocat" } } };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const provider = new GitHubProjectV2Provider({ fetch: fetchImpl });
    await provider.initialize({ githubToken: "ghp_test" });

    const boards = await provider.listBoards({
      targetBoardId: "3",
      targetBoardOwner: "taste-the-city",
    });

    expect(boards).toEqual([{ providerId: "github", boardId: "PVT_org", title: "Org board" }]);
  });

  it("resolves a configured GraphQL node id without a discovery list", async () => {
    const { provider, calls } = makeProvider({
      token: "ghp_test",
      configuredBoard: { id: "PVT_configured", title: "Release board" },
    });
    await provider.initialize({ githubToken: "ghp_test" });

    const boards = await provider.listBoards({ targetBoardId: "PVT_configured" });

    expect(boards).toEqual([
      { providerId: "github", boardId: "PVT_configured", title: "Release board" },
    ]);
    expect(calls.some((entry) => entry.query.startsWith("query KanbanViewerProjects"))).toBe(false);
  });

  it("names the type when a configured node id is not a project", async () => {
    // `node(id:)` answers a non-project id with an empty ProjectV2 fragment,
    // which would otherwise become a board ref carrying no id at all.
    const { provider } = makeProvider({
      token: "ghp_test",
      configuredNode: { __typename: "Repository" },
    });
    await provider.initialize({ githubToken: "ghp_test" });

    await expect(provider.listBoards({ targetBoardId: "R_kgDOABCDEF" })).rejects.toThrow(
      /is not a project: R_kgDOABCDEF is a Repository/,
    );
  });

  it("rejects an ownerless configured board number rather than choosing another board", async () => {
    const { provider } = makeProvider({ token: "ghp_test" });
    await provider.initialize({ githubToken: "ghp_test" });

    await expect(provider.listBoards({ targetBoardId: "12" })).rejects.toThrow(/needs an owner/i);
  });

  it("reports signed out, and points at the gh CLI, when it has no token", async () => {
    // The token comes from `gh auth token`, so "no token" means the host is
    // signed out of the GitHub CLI - the error has to send the user there and
    // not to a Kanban settings field, which does not exist.
    const { provider } = makeProvider({ token: null });
    await provider.initialize({ githubToken: null });
    await expect(provider.listBoards({})).rejects.toThrow(/gh auth login/);
  });

  it("normalizes a board into status columns plus an unassigned bucket", async () => {
    const { provider } = makeBoardProvider();
    await provider.initialize({ githubToken: "ghp_test" });

    const { board } = await provider.getBoard("PVT_1");
    expect(board.title).toBe("Engineering Board");

    const columnNames = board.columns.map((c) => c.name);
    expect(columnNames).toContain("To Do");
    expect(columnNames).toContain("Done");
    // Priority is a single-select too, and its options are not columns.
    expect(columnNames).not.toContain("High");

    const todo = board.columns.find((c) => c.name === "To Do");
    expect(todo?.id).toBe("opt-todo");
    expect(todo?.cards.map((c) => c.id)).toContain("item-1");

    // The item with no status value lands in the synthetic unassigned column.
    const unassigned = board.columns.find((c) => c.id === GITHUB_UNASSIGNED_COLUMN_ID);
    expect(unassigned?.name).toBe("Unassigned");
    expect(unassigned?.cards.map((c) => c.id)).toContain("item-2");
  });

  it("places a card by the status field's value, not by the first single-select", async () => {
    // item-1 carries a Priority value ahead of its Status value on the wire.
    // Binding on field id is the only thing that keeps it out of "High".
    const { provider } = makeBoardProvider();
    await provider.initialize({ githubToken: "ghp_test" });
    const { board } = await provider.getBoard("PVT_1");

    const todo = board.columns.find((c) => c.id === "opt-todo");
    expect(todo?.cards.map((c) => c.id)).toEqual(["item-1"]);
    const card = todo?.cards.find((c) => c.id === "item-1");
    expect(card?.status).toBe("To Do");
    expect(card?.assignees).toEqual(["alice"]);
    expect(card?.rawProviderId).toBe("item-1");
  });

  it("keeps draft issues as cards, without inventing a URL for them", async () => {
    // A draft issue lives only inside the project. Skipping that content arm
    // silently drops every card on a board that has not linked repo issues yet.
    const { provider } = makeBoardProvider();
    await provider.initialize({ githubToken: "ghp_test" });
    const { board } = await provider.getBoard("PVT_1");

    const done = board.columns.find((c) => c.id === "opt-done");
    const draft = done?.cards.find((c) => c.id === "item-3");
    expect(draft?.title).toBe("Think about caching");
    expect(draft?.url).toBeUndefined();
  });

  it("reads every item page", async () => {
    const [first, second, third] = makeItemNodes();
    const { provider, calls } = makeProvider({
      token: "ghp_test",
      layout: makeLayoutNode(),
      itemPages: [
        { nodes: [first], pageInfo: { hasNextPage: true, endCursor: "cursor-1" } },
        { nodes: [second, third], pageInfo: { hasNextPage: false, endCursor: null } },
      ],
    });
    await provider.initialize({ githubToken: "ghp_test" });

    const { board } = await provider.getBoard("PVT_1");
    const ids = cardIdsOf(board);
    expect(ids).toEqual(expect.arrayContaining(["item-1", "item-2", "item-3"]));

    const itemCalls = calls.filter((c) => c.query.startsWith("query KanbanBoardItems"));
    expect(itemCalls).toHaveLength(2);
    expect(itemCalls[1]?.variables).toMatchObject({ itemCursor: "cursor-1" });
  });

  it("reports a board larger than it will read, instead of serving a partial one", async () => {
    // Every page claims another one follows: a truncated board must not be
    // handed over as if it were the whole thing.
    const { provider } = makeProvider({
      token: "ghp_test",
      layout: makeLayoutNode(),
      itemPages: [{ nodes: [], pageInfo: { hasNextPage: true, endCursor: "cursor-forever" } }],
    });
    await provider.initialize({ githubToken: "ghp_test" });

    await expect(provider.getBoard("PVT_1")).rejects.toThrow(/more than Otto\s+reads|more than/);
  });

  it("rejects a card whose field values continue beyond the embedded page", async () => {
    const [item] = makeItemNodes();
    const overflowing = {
      ...item,
      fieldValues: { ...item.fieldValues, pageInfo: { hasNextPage: true } },
    };
    const { provider } = makeProvider({
      token: "ghp_test",
      layout: makeLayoutNode(),
      itemPages: [{ nodes: [overflowing] }],
    });
    await provider.initialize({ githubToken: "ghp_test" });
    await expect(provider.getBoard("PVT_1")).rejects.toThrow(
      /field values.*cannot read completely/i,
    );
  });

  it("rejects an item page that says more items exist but has no cursor", async () => {
    const { provider } = makeProvider({
      token: "ghp_test",
      layout: makeLayoutNode(),
      itemPages: [{ nodes: [], pageInfo: { hasNextPage: true, endCursor: null } }],
    });
    await provider.initialize({ githubToken: "ghp_test" });
    await expect(provider.getBoard("PVT_1")).rejects.toThrow(/without a cursor/i);
  });

  it("moves a card by posting a field-value mutation", async () => {
    const { provider, calls } = makeBoardProvider();
    await provider.initialize({ githubToken: "ghp_test" });
    await provider.getBoard("PVT_1");
    await provider.moveCard("PVT_1", "item-1", "opt-done");

    const moveCall = calls.find((c) => c.query.startsWith("mutation KanbanSetCardStatus"));
    expect(moveCall).toBeDefined();
    expect(moveCall?.variables).toMatchObject({
      projectId: "PVT_1",
      itemId: "item-1",
      fieldId: "field-status",
      optionId: "opt-done",
    });
  });

  it("moves a second card without waiting for a board refresh", async () => {
    // The board layout does not change when a card moves, so a move must not
    // depend on a getBoard landing between two drags.
    const { provider, calls } = makeBoardProvider();
    await provider.initialize({ githubToken: "ghp_test" });
    await provider.getBoard("PVT_1");

    await provider.moveCard("PVT_1", "item-1", "opt-done");
    await provider.moveCard("PVT_1", "item-2", "opt-done");

    expect(calls.filter((c) => c.query.startsWith("mutation KanbanSetCardStatus"))).toHaveLength(2);
  });

  it("resolves the board layout on demand when a move arrives before any read", async () => {
    const { provider, calls } = makeBoardProvider();
    await provider.initialize({ githubToken: "ghp_test" });

    await provider.moveCard("PVT_1", "item-1", "opt-done");

    expect(calls.some((c) => c.query.startsWith("query KanbanBoardLayout"))).toBe(true);
    expect(calls.some((c) => c.query.startsWith("mutation KanbanSetCardStatus"))).toBe(true);
  });

  it("clears the status field when dropped on the unassigned column", async () => {
    // `ProjectV2FieldValue` rejects an input with no value set, so emptying a
    // field is its own mutation rather than a null option id.
    const { provider, calls } = makeBoardProvider();
    await provider.initialize({ githubToken: "ghp_test" });
    await provider.getBoard("PVT_1");
    await provider.moveCard("PVT_1", "item-1", GITHUB_UNASSIGNED_COLUMN_ID);

    const clearCall = calls.find((c) => c.query.startsWith("mutation KanbanClearCardStatus"));
    expect(clearCall?.variables).toEqual({
      projectId: "PVT_1",
      itemId: "item-1",
      fieldId: "field-status",
    });
    expect(calls.some((c) => c.query.startsWith("mutation KanbanSetCardStatus"))).toBe(false);
  });

  it("rejects a move to an unknown column", async () => {
    const { provider } = makeBoardProvider();
    await provider.initialize({ githubToken: "ghp_test" });
    await provider.getBoard("PVT_1");
    await expect(provider.moveCard("PVT_1", "item-1", "opt-unknown")).rejects.toThrow(
      /Unknown column/,
    );
  });

  it("says what to fix when the board has no single-select status field", async () => {
    const layout = makeLayoutNode();
    layout.fields.nodes = [{ __typename: "ProjectV2Field", id: "field-text", name: "Notes" }];
    const { provider } = makeProvider({ token: "ghp_test", layout, itemPages: [{ nodes: [] }] });
    await provider.initialize({ githubToken: "ghp_test" });

    await expect(provider.moveCard("PVT_1", "item-1", "opt-done")).rejects.toThrow(
      /Add a Status field to the project in GitHub/,
    );
  });

  it("creates a card as a draft issue and places it in the requested column", async () => {
    const { provider, calls } = makeBoardProvider();
    await provider.initialize({ githubToken: "ghp_test" });
    await provider.getBoard("PVT_1");

    const card = await provider.createCard("PVT_1", "opt-todo", {
      title: "Drafted",
      body: "notes",
    });

    expect(card).toMatchObject({ id: "item-new", title: "Drafted", status: "To Do" });
    expect(card.url).toBeUndefined();
    const placement = calls.findLast((c) => c.query.startsWith("mutation KanbanSetCardStatus"));
    expect(placement?.variables).toMatchObject({ itemId: "item-new", optionId: "opt-todo" });
  });

  it("links an existing issue by number using the project's repository", async () => {
    const { provider, calls } = makeProvider({
      token: "ghp_test",
      layout: makeLayoutNode(),
      itemPages: [{ nodes: [] }],
      resolveTask: {
        repository: {
          issue: {
            id: "I_issue7",
            title: "Existing work",
            url: "https://github.com/acme/widgets/issues/7",
            bodyText: "",
          },
          pullRequest: null,
        },
      },
    });
    await provider.initialize({ githubToken: "ghp_test" });

    const card = await provider.linkExternalTask(
      "PVT_1",
      { owner: "acme", repo: "widgets", externalId: "7" },
      "opt-todo",
    );

    expect(card).toMatchObject({ id: "item-linked", status: "To Do" });
    const linkCall = calls.find((c) => c.query.startsWith("mutation KanbanLinkTask"));
    expect(linkCall?.variables).toMatchObject({ projectId: "PVT_1", contentId: "I_issue7" });
  });

  it("resolves a pasted issue URL against its own repository", async () => {
    const { provider, calls } = makeProvider({
      token: "ghp_test",
      layout: makeLayoutNode(),
      itemPages: [{ nodes: [] }],
      resolveTask: {
        repository: {
          issue: {
            id: "I_issue7",
            title: "Existing work",
            url: "https://github.com/acme/widgets/issues/7",
            bodyText: "",
          },
          pullRequest: null,
        },
      },
    });
    await provider.initialize({ githubToken: "ghp_test" });
    await provider.linkExternalTask(
      "PVT_1",
      { externalId: "https://github.com/acme/widgets/issues/7" },
      null,
    );
    const resolveCall = calls.find((call) => call.query.startsWith("query KanbanResolveTask"));
    expect(resolveCall?.variables).toMatchObject({ owner: "acme", name: "widgets", number: 7 });
  });

  it("refuses to guess a repository when linking a bare issue number", async () => {
    // Any repository would resolve *some* issue with that number, and it would
    // be the wrong one.
    const { provider } = makeBoardProvider();
    await provider.initialize({ githubToken: "ghp_test" });

    await expect(provider.linkExternalTask("PVT_1", { externalId: "7" }, null)).rejects.toThrow(
      /needs a repository/,
    );
  });

  it("links by node id without resolving a repository", async () => {
    const { provider, calls } = makeProvider({
      token: "ghp_test",
      layout: makeLayoutNode(),
      itemPages: [{ nodes: [] }],
    });
    await provider.initialize({ githubToken: "ghp_test" });

    await provider.linkExternalTask("PVT_1", { externalId: "I_kwDOABCDEF" }, null);

    expect(calls.some((c) => c.query.startsWith("query KanbanResolveTask"))).toBe(false);
    const linkCall = calls.find((c) => c.query.startsWith("mutation KanbanLinkTask"));
    expect(linkCall?.variables).toMatchObject({ contentId: "I_kwDOABCDEF" });
  });

  it("tolerates GitHub's NOT_FOUND for the half of the resolve query that cannot match", async () => {
    // A number names an issue or a pull request, never both, so GitHub answers
    // the real one alongside a nested NOT_FOUND for the other.
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { query: string };
      if (body.query.startsWith("query KanbanResolveTask")) {
        return new Response(
          JSON.stringify({
            data: {
              repository: {
                issue: null,
                pullRequest: {
                  id: "PR_1",
                  title: "interactive pr list",
                  url: "https://github.com/cli/cli/pull/1",
                  bodyText: "",
                },
              },
            },
            errors: [
              {
                type: "NOT_FOUND",
                path: ["repository", "issue"],
                message: "Could not resolve to an Issue with the number of 1.",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (body.query.startsWith("mutation KanbanLinkTask")) {
        return new Response(
          JSON.stringify({
            data: {
              addProjectV2ItemById: {
                item: {
                  id: "item-linked",
                  content: {
                    __typename: "PullRequest",
                    title: "interactive pr list",
                    url: "https://github.com/cli/cli/pull/1",
                    bodyText: "",
                    assignees: { nodes: [] },
                  },
                },
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ data: { viewer: { login: "octocat" } } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const provider = new GitHubProjectV2Provider({ fetch: fetchImpl });
    await provider.initialize({ githubToken: "ghp_test" });

    const card = await provider.linkExternalTask(
      "PVT_1",
      { owner: "cli", repo: "cli", externalId: "1" },
      null,
    );

    expect(card.id).toBe("item-linked");
  });

  it("turns an insufficient-scopes response into a gh auth refresh remediation", async () => {
    const provider = makeScopeFailureProvider();
    await provider.initialize({ githubToken: "gho_test" });
    const error = await provider.listBoards({}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(KanbanRemediationError);
    const remediation = (error as KanbanRemediationError).remediation;
    expect(remediation.reason).toBe(KANBAN_REMEDIATION_GITHUB_SCOPES);
    expect(remediation.missingScopes).toEqual(["read:project"]);
    expect(remediation.steps).toEqual([
      {
        command: "gh",
        args: ["auth", "refresh", "-s", "read:project,project"],
        display: "gh auth refresh -s read:project,project",
      },
    ]);
    // GitHub's own text points at the personal access token page, which is the
    // wrong page for a gh CLI credential: none of it survives.
    expect((error as Error).message).not.toContain("settings/tokens");
    expect((error as Error).message).toContain("read:project");
  });

  it("reads the granted scopes from the response header when the message omits them", async () => {
    const provider = makeScopeFailureProvider({
      message:
        "Your token has not been granted the required scopes to execute this query. " +
        "The 'id' field requires one of the following scopes: ['read:project'].",
      grantedHeader: "gist, read:org, repo, workflow, read:project",
    });
    await provider.initialize({ githubToken: "gho_test" });
    const error = (await provider
      .listBoards({})
      .catch((e: unknown) => e)) as KanbanRemediationError;

    // Already granted, so it is not reported missing; the command still asks
    // for both scopes because the write half is what is actually absent.
    expect(error.remediation.missingScopes).toBeUndefined();
    expect(error.remediation.steps[0]?.display).toBe("gh auth refresh -s read:project,project");
  });

  it("targets the gh host for a GitHub Enterprise base url", async () => {
    const provider = makeScopeFailureProvider({ apiBaseUrl: "https://ghe.example.com/api/v3" });
    await provider.initialize({ githubToken: "gho_test" });
    const error = (await provider
      .listBoards({})
      .catch((e: unknown) => e)) as KanbanRemediationError;

    expect(error.remediation.steps[0]?.args).toEqual([
      "auth",
      "refresh",
      "-h",
      "ghe.example.com",
      "-s",
      "read:project,project",
    ]);
  });

  it("leaves an unrelated GraphQL error as a plain error", async () => {
    const provider = makeScopeFailureProvider({
      message: "Something went wrong.",
      type: "NOT_FOUND",
    });
    await provider.initialize({ githubToken: "gho_test" });
    const error = await provider.listBoards({}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(KanbanRemediationError);
    expect((error as Error).message).toBe("Something went wrong.");
  });
});

/**
 * Guards on the documents themselves.
 *
 * Every assertion here corresponds to a name that shipped wrong and made the
 * whole provider inert: GitHub rejected the document during validation, so no
 * amount of response-shape testing could see it. These read the documents the
 * provider actually sends, which is the one thing a stubbed `fetch` can verify
 * about them. `.tmp/validate-kanban-graphql.mjs` is the live-API counterpart.
 */
describe("the documents GitHub actually accepts", () => {
  async function capture(): Promise<string> {
    const { provider, calls } = makeBoardProvider();
    await provider.initialize({ githubToken: "ghp_test" });
    await provider.getBoard("PVT_1");
    await provider.moveCard("PVT_1", "item-1", "opt-done");
    await provider.moveCard("PVT_1", "item-1", GITHUB_UNASSIGNED_COLUMN_ID);
    await provider.createCard("PVT_1", "opt-todo", { title: "Drafted" });
    await provider.linkExternalTask("PVT_1", { externalId: "I_kwDOABCDEF" }, "opt-todo");
    await provider.listBoards({ targetBoardId: "PVT_1" }).catch(() => undefined);
    return calls.map((c) => c.query).join("\n");
  }

  it("names the single-select field type as the schema does", async () => {
    const documents = await capture();
    expect(documents).toContain("... on ProjectV2SingleSelectField");
    // The name that never existed, and produced "No such type
    // ProjectV2FieldSingleSelect, so it can't be a fragment condition".
    expect(documents).not.toContain("ProjectV2FieldSingleSelect ");
    expect(documents).not.toContain("ProjectV2FieldSingleSelect {");
  });

  it("reads field id and name through ProjectV2FieldCommon, never off the union", async () => {
    const documents = await capture();
    // ProjectV2FieldConfiguration is a union: selecting on it directly produced
    // "Selections can't be made directly on unions".
    expect(documents).toContain("... on ProjectV2FieldCommon { id name dataType }");
    expect(documents).toMatch(/fields\(first: \d+, after: \$fieldCursor\) \{ pageInfo/);
    expect(documents).not.toMatch(/nodes \{ id name \.\.\. on ProjectV2/);
  });

  it("treats single-select options as a plain list", async () => {
    const documents = await capture();
    expect(documents).toContain("options { id name }");
    expect(documents).not.toContain("options(first:");
  });

  it("asks for __typename wherever it narrows on one", async () => {
    const documents = await capture();
    // GitHub returns __typename only when it is selected, so every union arm
    // the provider narrows on has to request it.
    for (const document of documents.split("\n")) {
      if (/\.\.\. on /.test(document)) {
        expect(document).toContain("__typename");
      }
    }
  });

  it("uses the mutations that exist", async () => {
    const documents = await capture();
    expect(documents).toContain("addProjectV2DraftIssue(input:");
    expect(documents).toContain("addProjectV2ItemById(input:");
    expect(documents).toContain("clearProjectV2ItemFieldValue(input:");
    // Never existed, and took no such arguments.
    expect(documents).not.toContain("addProjectV2ItemToProject");
    expect(documents).not.toContain("contentKind:");
  });

  it("covers every project item content arm on the board read", async () => {
    const documents = await capture();
    const boardItems = documents
      .split("\n")
      .find((line) => line.startsWith("query KanbanBoardItems"));
    expect(boardItems).toContain("... on DraftIssue");
    expect(boardItems).toContain("... on Issue");
    expect(boardItems).toContain("... on PullRequest");
  });
});
