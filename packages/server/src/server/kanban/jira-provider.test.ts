import { describe, expect, it } from "vitest";
import { JIRA_UNASSIGNED_COLUMN_ID, JiraKanbanProvider } from "./jira-provider.js";

/**
 * Builds a fetch stub that routes on the Jira REST v3 URL path. Returns the
 * captured calls plus the provider.
 */
function makeProvider(options: {
  token?: string | null;
  boards?: Array<{ id: number; name: string }>;
  board?: { id: number; name: string };
  filters?: Array<{ id: number; name: string }>;
  issues?: Array<{ key: string; summary: string; assignee?: string; description?: string }>;
  filterMembers: Record<number, string[]>;
}) {
  const calls: Array<{ method: string; path: string; body: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : null;
    calls.push({ method, path: url.pathname, body });

    const issue = (key: string): unknown => {
      const source = options.issues?.find((i) => i.key === key);
      return {
        key,
        self: `https://acme.atlassian.net/rest/api/3/issue/${key}`,
        fields: {
          summary: source?.summary ?? key,
          description: source?.description ?? null,
          assignee: source?.assignee ? { displayName: source.assignee } : null,
        },
      };
    };

    const payload = routeJiraStub(url.pathname, method, body, options, issue);
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { calls, provider: new JiraKanbanProvider({ fetch: fetchImpl }) };
}

/** Routes a Jira REST path to its canned payload. */
function routeJiraStub(
  pathname: string,
  method: string,
  body: string | null,
  options: {
    boards?: Array<{ id: number; name: string }>;
    board?: { id: number; name: string };
    filters?: Array<{ id: number; name: string }>;
    issues?: Array<{ key: string; summary: string; assignee?: string; description?: string }>;
    filterMembers: Record<number, string[]>;
  },
  issue: (key: string) => unknown,
): unknown {
  if (pathname === "/ex/jira/api/3/board") {
    return (options.boards ?? [{ id: 100, name: "Sprint Board" }]).map((b) => ({
      id: b.id,
      name: b.name,
      self: `https://acme.atlassian.net/rest/api/3/board/${b.id}`,
    }));
  }
  if (pathname === "/ex/jira/api/3/board/100") {
    return {
      id: options.board?.id ?? 100,
      name: options.board?.name ?? "Sprint Board",
      self: "https://acme.atlassian.net/rest/api/3/board/100",
    };
  }
  if (pathname === "/ex/jira/api/3/board/100/filter") {
    return (options.filters ?? []).map((f) => ({ id: f.id, name: f.name }));
  }
  if (pathname.startsWith("/ex/jira/api/3/board/100/issues")) {
    return (options.issues ?? []).map((i) => issue(i.key));
  }
  if (pathname === "/ex/jira/api/3/issue" && method === "POST") {
    // The created issue gets the next key and echoes the requested fields.
    const requested = JSON.parse(String(body)) as {
      fields: { summary: string; description?: string };
    };
    return {
      key: "PROJ-10",
      self: "https://acme.atlassian.net/rest/api/3/issue/PROJ-10",
      fields: {
        summary: requested.fields.summary,
        description: requested.fields.description ?? null,
        assignee: null,
      },
    };
  }
  const issueGetMatch = pathname.match(/\/ex\/jira\/api\/3\/issue\/([^/]+)/);
  if (issueGetMatch) {
    return issue(decodeURIComponent(issueGetMatch[1]));
  }
  const memberMatch = pathname.match(/\/ex\/jira\/api\/3\/board\/100\/quickfilter\/(\d+)\/search/);
  if (memberMatch) {
    const keys = options.filterMembers[Number(memberMatch[1])] ?? [];
    return keys.map((key) => issue(key));
  }
  return {};
}

describe("JiraKanbanProvider", () => {
  it("lists the site's boards", async () => {
    const { provider } = makeProvider({ token: "jira_tok", filterMembers: {} });
    await provider.initialize({ jiraToken: "jira_tok" });
    const boards = await provider.listBoards({});
    expect(boards).toEqual([{ providerId: "jira", boardId: "100", title: "Sprint Board" }]);
  });

  it("reports unconfigured when no token is set", async () => {
    const { provider } = makeProvider({ token: null, filterMembers: {} });
    await provider.initialize({ jiraToken: null });
    await expect(provider.listBoards({})).rejects.toThrow(/not configured/i);
  });

  it("normalizes a board into quick-filter columns plus an unassigned bucket", async () => {
    const { provider } = makeProvider({
      token: "jira_tok",
      filters: [
        { id: 1, name: "This Sprint" },
        { id: 2, name: "Blocked" },
      ],
      issues: [
        { key: "PROJ-1", summary: "Do the thing", assignee: "alice" },
        { key: "PROJ-2", summary: "Other thing", description: "blocked by infra" },
        { key: "PROJ-3", summary: "No filter" },
      ],
      filterMembers: { 1: ["PROJ-1"], 2: ["PROJ-2"] },
    });
    await provider.initialize({ jiraToken: "jira_tok" });
    const board = await provider.getBoard("100");

    expect(board.id).toBe("100");
    expect(board.title).toBe("Sprint Board");

    const sprint = board.columns.find((c) => c.name === "This Sprint");
    expect(sprint?.id).toBe("1");
    expect(sprint?.cards.map((c) => c.id)).toEqual(["PROJ-1"]);

    const blocked = board.columns.find((c) => c.name === "Blocked");
    expect(blocked?.id).toBe("2");
    expect(blocked?.cards.map((c) => c.id)).toEqual(["PROJ-2"]);

    // The issue in no filter lands in the synthetic unassigned column.
    const unassigned = board.columns.find((c) => c.id === JIRA_UNASSIGNED_COLUMN_ID);
    expect(unassigned?.name).toBe("Unassigned");
    expect(unassigned?.cards.map((c) => c.id)).toEqual(["PROJ-3"]);
  });

  it("maps the filter name onto the card status and the issue key onto rawProviderId", async () => {
    const { provider } = makeProvider({
      token: "jira_tok",
      filters: [{ id: 1, name: "This Sprint" }],
      issues: [{ key: "PROJ-1", summary: "Do the thing", assignee: "alice" }],
      filterMembers: { 1: ["PROJ-1"] },
    });
    await provider.initialize({ jiraToken: "jira_tok" });
    const board = await provider.getBoard("100");
    const card = board.columns.find((c) => c.id === "1")?.cards.find((c) => c.id === "PROJ-1");
    expect(card?.status).toBe("This Sprint");
    expect(card?.assignees).toEqual(["alice"]);
    expect(card?.rawProviderId).toBe("PROJ-1");
  });

  it("moves a card into a quick filter via addIssue", async () => {
    const { provider, calls } = makeProvider({
      token: "jira_tok",
      filters: [
        { id: 1, name: "This Sprint" },
        { id: 2, name: "Blocked" },
      ],
      issues: [{ key: "PROJ-1", summary: "Do the thing" }],
      filterMembers: { 1: ["PROJ-1"], 2: [] },
    });
    await provider.initialize({ jiraToken: "jira_tok" });
    await provider.getBoard("100");
    await provider.moveCard("100", "PROJ-1", "2");

    const moveCall = calls.find((c) => c.path === "/ex/jira/api/3/quickfilter/2/addIssue");
    expect(moveCall).toBeDefined();
    expect(moveCall?.method).toBe("POST");
    expect(JSON.parse(moveCall?.body ?? "{}")).toEqual({ issue: "PROJ-1" });
  });

  it("clears every filter when dropped on the unassigned column", async () => {
    const { provider, calls } = makeProvider({
      token: "jira_tok",
      filters: [
        { id: 1, name: "This Sprint" },
        { id: 2, name: "Blocked" },
      ],
      issues: [{ key: "PROJ-1", summary: "Do the thing" }],
      // The issue matches both filters; moving it to Unassigned must remove
      // it from both.
      filterMembers: { 1: ["PROJ-1"], 2: ["PROJ-1"] },
    });
    await provider.initialize({ jiraToken: "jira_tok" });
    await provider.getBoard("100");
    await provider.moveCard("100", "PROJ-1", JIRA_UNASSIGNED_COLUMN_ID);

    const removes = calls.filter((c) => c.method === "POST" && c.path.endsWith("/removeIssue"));
    expect(removes.map((c) => c.path).sort()).toEqual([
      "/ex/jira/api/3/quickfilter/1/removeIssue",
      "/ex/jira/api/3/quickfilter/2/removeIssue",
    ]);
  });

  it("rejects a move to an unknown column", async () => {
    const { provider } = makeProvider({
      token: "jira_tok",
      filters: [{ id: 1, name: "This Sprint" }],
      issues: [{ key: "PROJ-1", summary: "Do the thing" }],
      filterMembers: { 1: ["PROJ-1"] },
    });
    await provider.initialize({ jiraToken: "jira_tok" });
    await provider.getBoard("100");
    await expect(provider.moveCard("100", "PROJ-1", "999")).rejects.toThrow(/Unknown column/);
  });

  it("creates a card in the board's project and restores it into the target filter", async () => {
    const { provider, calls } = makeProvider({
      token: "jira_tok",
      filters: [{ id: 1, name: "This Sprint" }],
      issues: [{ key: "PROJ-9", summary: "existing" }],
      filterMembers: { 1: [] },
    });
    await provider.initialize({ jiraToken: "jira_tok" });
    await provider.getBoard("100");
    const card = await provider.createCard("100", "1", { title: "New task", body: "details" });

    expect(card.title).toBe("New task");
    expect(card.body).toBe("details");
    expect(card.status).toBe("This Sprint");

    const createCall = calls.find((c) => c.path === "/ex/jira/api/3/issue" && c.method === "POST");
    expect(createCall).toBeDefined();
    expect(JSON.parse(createCall?.body ?? "{}")).toEqual({
      fields: { project: { key: "PROJ" }, summary: "New task", description: "details" },
    });
    const addCall = calls.find((c) => c.path === "/ex/jira/api/3/quickfilter/1/addIssue");
    expect(addCall).toBeDefined();
  });

  it("links an existing issue into a quick filter", async () => {
    const { provider, calls } = makeProvider({
      token: "jira_tok",
      filters: [{ id: 1, name: "This Sprint" }],
      issues: [{ key: "PROJ-1", summary: "Do the thing" }],
      filterMembers: { 1: [] },
    });
    await provider.initialize({ jiraToken: "jira_tok" });
    await provider.getBoard("100");
    const card = await provider.linkExternalTask("100", { externalId: "PROJ-1" }, "1");
    expect(card.id).toBe("PROJ-1");
    expect(card.status).toBe("This Sprint");
    const addCall = calls.find((c) => c.path === "/ex/jira/api/3/quickfilter/1/addIssue");
    expect(addCall).toBeDefined();
    expect(JSON.parse(addCall?.body ?? "{}")).toEqual({ issue: "PROJ-1" });
  });
});
