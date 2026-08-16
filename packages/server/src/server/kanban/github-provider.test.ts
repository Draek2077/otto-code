import { describe, expect, it } from "vitest";
import { GITHUB_UNASSIGNED_COLUMN_ID, GitHubProjectV2Provider } from "./github-provider.js";

/**
 * Builds a fetch stub that routes on the GraphQL document in the request body.
 * Returns the captured calls plus the provider.
 */
function makeProvider(options: {
  token?: string | null;
  viewerProjects?: { id: string; title: string; url?: string }[];
  board?: unknown;
}) {
  const calls: Array<{ url: string; query: string; variables: Record<string, unknown> }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      query: string;
      variables: Record<string, unknown>;
    };
    calls.push({ url: String(input), query: body.query, variables: body.variables });
    let data: unknown = {};
    if (body.query.startsWith("query KanbanViewerProjects")) {
      data = { viewer: { projectsV2: { nodes: options.viewerProjects ?? [] } } };
    } else if (body.query.startsWith("query KanbanViewer")) {
      // The login probe only requests viewer { login }.
      data = { viewer: { login: "octocat" } };
    } else if (body.query.startsWith("query KanbanBoard")) {
      data = { node: options.board ?? null };
    } else if (
      body.query.startsWith("mutation KanbanMoveCard") ||
      body.query.startsWith("mutation KanbanCardStatus") ||
      body.query.startsWith("mutation KanbanCreateCard") ||
      body.query.startsWith("mutation KanbanLinkTask")
    ) {
      data = { ok: true };
    }
    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { calls, provider: new GitHubProjectV2Provider({ fetch: fetchImpl }) };
}

/** A ProjectV2 node with one single-select field named "Status" (two options)
    and a mix of assigned / unassigned issue items. */
function makeBoardNode() {
  return {
    __typename: "ProjectV2",
    title: "Engineering Board",
    fields: {
      nodes: [
        { __typename: "ProjectV2FieldText", id: "field-text", name: "Notes" },
        {
          __typename: "ProjectV2FieldSingleSelect",
          id: "field-status",
          name: "Status",
          options: {
            nodes: [
              { id: "opt-todo", name: "To Do" },
              { id: "opt-done", name: "Done" },
            ],
          },
        },
      ],
    },
    items: {
      nodes: [
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
              {
                __typename: "ProjectV2ItemFieldSingleSelectValue",
                name: "To Do",
                optionId: "opt-todo",
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
          fieldValues: { nodes: [] },
        },
      ],
    },
  };
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

  it("reports unconfigured when no token is set", async () => {
    const { provider } = makeProvider({ token: null });
    await provider.initialize({ githubToken: null });
    await expect(provider.listBoards({})).rejects.toThrow(/not configured/i);
  });

  it("normalizes a board into status columns plus an unassigned bucket", async () => {
    const { provider } = makeProvider({ token: "ghp_test", board: makeBoardNode() });
    await provider.initialize({ githubToken: "ghp_test" });
    await provider.getBoard("PVT_1");

    // Re-fetch to read the normalized board.
    const board = await provider.getBoard("PVT_1");
    expect(board.title).toBe("Engineering Board");

    const columnNames = board.columns.map((c) => c.name);
    expect(columnNames).toContain("To Do");
    expect(columnNames).toContain("Done");

    const todo = board.columns.find((c) => c.name === "To Do");
    expect(todo?.id).toBe("opt-todo");
    expect(todo?.cards.map((c) => c.id)).toContain("item-1");

    // The item with no status value lands in the synthetic unassigned column.
    const unassigned = board.columns.find((c) => c.id === GITHUB_UNASSIGNED_COLUMN_ID);
    expect(unassigned?.name).toBe("Unassigned");
    expect(unassigned?.cards.map((c) => c.id)).toContain("item-2");
  });

  it("maps the status field's clear-text option name onto the card", async () => {
    const { provider } = makeProvider({ token: "ghp_test", board: makeBoardNode() });
    await provider.initialize({ githubToken: "ghp_test" });
    const board = await provider.getBoard("PVT_1");
    const todo = board.columns.find((c) => c.name === "To Do");
    const card = todo?.cards.find((c) => c.id === "item-1");
    expect(card?.status).toBe("To Do");
    expect(card?.assignees).toEqual(["alice"]);
    expect(card?.rawProviderId).toBe("item-1");
  });

  it("moves a card by posting a field-value mutation", async () => {
    const { provider, calls } = makeProvider({ token: "ghp_test", board: makeBoardNode() });
    await provider.initialize({ githubToken: "ghp_test" });
    await provider.getBoard("PVT_1");
    await provider.moveCard("PVT_1", "item-1", "opt-done");

    const moveCall = calls.find((c) => c.query.startsWith("mutation KanbanMoveCard"));
    expect(moveCall).toBeDefined();
    expect(moveCall?.variables).toMatchObject({
      projectId: "PVT_1",
      itemId: "item-1",
      fieldId: "field-status",
      optionId: "opt-done",
    });
  });

  it("clears the status field when dropped on the unassigned column", async () => {
    const { provider, calls } = makeProvider({ token: "ghp_test", board: makeBoardNode() });
    await provider.initialize({ githubToken: "ghp_test" });
    await provider.getBoard("PVT_1");
    await provider.moveCard("PVT_1", "item-1", GITHUB_UNASSIGNED_COLUMN_ID);

    const moveCall = calls.find((c) => c.query.startsWith("mutation KanbanMoveCard"));
    expect(moveCall).toBeDefined();
    expect(moveCall?.variables).not.toHaveProperty("optionId");
  });

  it("rejects a move to an unknown column", async () => {
    const { provider } = makeProvider({ token: "ghp_test", board: makeBoardNode() });
    await provider.initialize({ githubToken: "ghp_test" });
    await provider.getBoard("PVT_1");
    await expect(provider.moveCard("PVT_1", "item-1", "opt-unknown")).rejects.toThrow(
      /Unknown column/,
    );
  });
});
