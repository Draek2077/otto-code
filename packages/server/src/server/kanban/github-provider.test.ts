import { describe, expect, it } from "vitest";
import { KANBAN_REMEDIATION_GITHUB_SCOPES } from "@otto-code/protocol/kanban";
import { GITHUB_UNASSIGNED_COLUMN_ID, GitHubProjectV2Provider } from "./github-provider.js";
import { KanbanRemediationError } from "./kanban-remediation.js";

/**
 * Builds a fetch stub that routes on the GraphQL document in the request body.
 * Returns the captured calls plus the provider.
 */
function makeProvider(options: {
  token?: string | null;
  viewerProjects?: { id: string; title: string; url?: string }[];
  configuredBoard?: { id: string; title: string; url?: string } | null;
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
    } else if (body.query.startsWith("query KanbanProjectByNumber")) {
      data = { organization: { projectV2: options.configuredBoard ?? null }, user: null };
    } else if (body.query.startsWith("query KanbanProjectByNode")) {
      data = { node: options.configuredBoard ?? null };
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
