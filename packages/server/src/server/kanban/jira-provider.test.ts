import { describe, expect, it } from "vitest";
import { JIRA_UNASSIGNED_COLUMN_ID, JiraKanbanProvider } from "./jira-provider.js";

const SITE = "https://acme.atlassian.net";

interface StubIssue {
  key: string;
  summary: string;
  /** Status id, matched against a column's statuses. */
  statusId: string;
  statusName?: string;
  assignee?: string;
  description?: unknown;
}

interface StubOptions {
  boards?: Array<{ id: number; name: string }>;
  columns?: Array<{ name: string; statusIds: string[] }>;
  issues?: StubIssue[];
  projectKey?: string;
  /** Transitions the stub offers for any issue: transition id -> target status id. */
  transitions?: Array<{ id: string; toStatusId: string }>;
  createdKey?: string;
}

const DEFAULT_COLUMNS = [
  { name: "To Do", statusIds: ["1"] },
  { name: "In Progress", statusIds: ["3"] },
];

const DEFAULT_ISSUES: StubIssue[] = [
  { key: "ENG-1", summary: "First issue", statusId: "1" },
  { key: "ENG-2", summary: "Second issue", statusId: "3", assignee: "Ada Lovelace" },
];

/**
 * Builds a fetch stub over the real Jira Cloud REST surface: boards and board
 * configuration come from the Agile API, issues and transitions from the
 * platform API. Returns the captured calls plus the provider.
 */
function makeProvider(options: StubOptions = {}) {
  const calls: Array<{ method: string; path: string; search: string; body: string | null }> = [];
  const issues = options.issues ?? DEFAULT_ISSUES;

  const asIssue = (issue: StubIssue): unknown => ({
    key: issue.key,
    self: `${SITE}/rest/api/3/issue/${issue.key}`,
    fields: {
      summary: issue.summary,
      description: issue.description ?? null,
      status: { id: issue.statusId, name: issue.statusName ?? "Status" },
      assignee: issue.assignee ? { displayName: issue.assignee } : null,
    },
  });

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : null;
    calls.push({ method, path: url.pathname, search: url.search, body });

    // A transition POST answers 204 with no body, exactly as Jira does.
    if (url.pathname.endsWith("/transitions") && method !== "GET") {
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify(routeJira(url.pathname, method, options, issues, asIssue)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  return { calls, provider: new JiraKanbanProvider({ fetch: fetchImpl, apiBaseUrl: SITE }) };
}

/** Maps a Jira Cloud REST path to its canned payload. */
function routeJira(
  path: string,
  method: string,
  options: StubOptions,
  issues: StubIssue[],
  asIssue: (issue: StubIssue) => unknown,
): unknown {
  switch (path) {
    case "/rest/agile/1.0/board":
      return {
        values: (options.boards ?? [{ id: 100, name: "Sprint Board" }]).map((board) => ({
          id: board.id,
          name: board.name,
        })),
      };
    case "/rest/agile/1.0/board/100":
      return { id: 100, name: options.boards?.[0]?.name ?? "Sprint Board" };
    case "/rest/agile/1.0/board/100/configuration":
      return {
        columnConfig: {
          columns: (options.columns ?? DEFAULT_COLUMNS).map((column) => ({
            name: column.name,
            statuses: column.statusIds.map((id) => ({ id })),
          })),
        },
      };
    case "/rest/agile/1.0/board/100/issue":
      return { issues: issues.map(asIssue) };
    case "/rest/agile/1.0/board/100/project":
      return { values: [{ key: options.projectKey ?? "ENG" }] };
    default:
      break;
  }
  if (path.endsWith("/transitions")) {
    return {
      transitions: (options.transitions ?? [{ id: "11", toStatusId: "3" }]).map((transition) => ({
        id: transition.id,
        to: { id: transition.toStatusId },
      })),
    };
  }
  if (path === "/rest/api/3/issue" && method === "POST") {
    return { key: options.createdKey ?? "ENG-9" };
  }
  if (path.startsWith("/rest/api/3/issue/")) {
    const key = path.slice("/rest/api/3/issue/".length);
    const found = issues.find((issue) => issue.key === key);
    return asIssue(found ?? { key, summary: `Summary for ${key}`, statusId: "1" });
  }
  return {};
}

const CREDENTIALS = {
  atlassianEmail: "dev@acme.com",
  atlassianApiToken: "atl_token",
  jiraSiteUrl: SITE,
};

describe("JiraKanbanProvider", () => {
  it("authenticates with the shared Atlassian credential as HTTP Basic", async () => {
    const captured: Array<Record<string, string>> = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      captured.push({ ...(init?.headers as Record<string, string>) });
      return new Response(JSON.stringify({ values: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const provider = new JiraKanbanProvider({ fetch: fetchImpl, apiBaseUrl: SITE });
    await provider.initialize(CREDENTIALS);

    const expected = Buffer.from("dev@acme.com:atl_token").toString("base64");
    expect(captured[0].Authorization).toBe(`Basic ${expected}`);
  });

  it("reports unconfigured until email, token, and site URL are all present", async () => {
    const { provider } = makeProvider();
    // A credential missing its site URL cannot address a Jira Cloud site at
    // all, so it is not "partly configured" - it is unconfigured.
    await provider.initialize({ ...CREDENTIALS, jiraSiteUrl: "" });
    await expect(provider.listBoards({})).rejects.toThrow(/not configured/i);
  });

  it("lists the site's boards from the Agile API", async () => {
    const { provider, calls } = makeProvider({
      boards: [
        { id: 100, name: "Sprint Board" },
        { id: 101, name: "Support Board" },
      ],
    });
    await provider.initialize(CREDENTIALS);
    const boards = await provider.listBoards({});

    expect(boards).toEqual([
      { providerId: "jira", boardId: "100", title: "Sprint Board" },
      { providerId: "jira", boardId: "101", title: "Support Board" },
    ]);
    expect(calls.every((call) => call.path.startsWith("/rest/"))).toBe(true);
  });

  it("returns only the configured board instead of the site's board list", async () => {
    const { provider, calls } = makeProvider({
      boards: [
        { id: 100, name: "Sprint Board" },
        { id: 101, name: "Support Board" },
      ],
    });
    await provider.initialize(CREDENTIALS);
    calls.length = 0;

    const boards = await provider.listBoards({ targetBoardId: "100" });

    expect(boards).toEqual([{ providerId: "jira", boardId: "100", title: "Sprint Board" }]);
    expect(calls.map((call) => call.path)).toEqual(["/rest/agile/1.0/board/100"]);
  });

  it("normalizes a board into its configured columns", async () => {
    const { provider } = makeProvider();
    await provider.initialize(CREDENTIALS);
    const board = await provider.getBoard("100");

    expect(board.title).toBe("Sprint Board");
    expect(board.columns.map((column) => column.id)).toEqual(["To Do", "In Progress"]);
    expect(board.columns[0].cards.map((card) => card.id)).toEqual(["ENG-1"]);
    expect(board.columns[1].cards.map((card) => card.id)).toEqual(["ENG-2"]);
  });

  it("places issues whose status maps to no column in an unassigned bucket", async () => {
    const { provider } = makeProvider({
      issues: [
        ...DEFAULT_ISSUES,
        // Status 99 belongs to no column; Jira allows this and the issue is
        // still on the board, so hiding it would lose the user's work.
        { key: "ENG-3", summary: "Orphan status", statusId: "99" },
      ],
    });
    await provider.initialize(CREDENTIALS);
    const board = await provider.getBoard("100");

    const unassigned = board.columns.find((column) => column.id === JIRA_UNASSIGNED_COLUMN_ID);
    expect(unassigned?.cards.map((card) => card.id)).toEqual(["ENG-3"]);
  });

  it("reads a board without querying per column", async () => {
    // The issue's own status decides its column, so board reads must not scale
    // with the number of columns.
    const { provider, calls } = makeProvider({
      columns: [
        { name: "A", statusIds: ["1"] },
        { name: "B", statusIds: ["2"] },
        { name: "C", statusIds: ["3"] },
        { name: "D", statusIds: ["4"] },
      ],
    });
    await provider.initialize(CREDENTIALS);
    calls.length = 0;
    await provider.getBoard("100");

    expect(calls).toHaveLength(4);
  });

  it("gives cards a browse URL rather than the REST self link", async () => {
    const { provider } = makeProvider();
    await provider.initialize(CREDENTIALS);
    const board = await provider.getBoard("100");

    expect(board.columns[0].cards[0].url).toBe(`${SITE}/browse/ENG-1`);
  });

  it("moves a card by transitioning it into a status the target column owns", async () => {
    const { provider, calls } = makeProvider({
      transitions: [
        { id: "5", toStatusId: "99" },
        { id: "11", toStatusId: "3" },
      ],
    });
    await provider.initialize(CREDENTIALS);
    await provider.getBoard("100");
    calls.length = 0;
    await provider.moveCard("100", "ENG-1", "In Progress");

    const posted = calls.find((call) => call.method === "POST");
    expect(posted?.path).toBe("/rest/api/3/issue/ENG-1/transitions");
    // Transition 5 lands on status 99, which "In Progress" does not own.
    expect(JSON.parse(posted?.body ?? "{}")).toEqual({ transition: { id: "11" } });
  });

  it("explains when the workflow offers no transition into the target column", async () => {
    const { provider } = makeProvider({ transitions: [{ id: "5", toStatusId: "99" }] });
    await provider.initialize(CREDENTIALS);
    await provider.getBoard("100");

    await expect(provider.moveCard("100", "ENG-1", "In Progress")).rejects.toThrow(
      /no available transition/i,
    );
  });

  it("rejects a move to an unknown column", async () => {
    const { provider } = makeProvider();
    await provider.initialize(CREDENTIALS);
    await provider.getBoard("100");

    await expect(provider.moveCard("100", "ENG-1", "Nope")).rejects.toThrow(/unknown column/i);
  });

  it("rejects a move into the synthetic unassigned column", async () => {
    const { provider } = makeProvider();
    await provider.initialize(CREDENTIALS);
    await provider.getBoard("100");

    await expect(provider.moveCard("100", "ENG-1", JIRA_UNASSIGNED_COLUMN_ID)).rejects.toThrow(
      /not a real Jira column/i,
    );
  });

  it("creates a card in the board's project", async () => {
    const { provider, calls } = makeProvider({ createdKey: "ENG-9" });
    await provider.initialize(CREDENTIALS);
    await provider.getBoard("100");
    calls.length = 0;
    const card = await provider.createCard("100", null, { title: "New work", body: "Details" });

    const created = calls.find(
      (call) => call.method === "POST" && call.path === "/rest/api/3/issue",
    );
    const fields = JSON.parse(created?.body ?? "{}").fields;
    expect(fields.project).toEqual({ key: "ENG" });
    expect(fields.summary).toBe("New work");
    // v3 takes Atlassian Document Format, not a plain string.
    expect(fields.description.type).toBe("doc");
    expect(card.id).toBe("ENG-9");
  });

  it("round-trips a card body through Atlassian Document Format", async () => {
    const { provider } = makeProvider({
      issues: [
        {
          key: "ENG-1",
          summary: "First issue",
          statusId: "1",
          description: {
            type: "doc",
            version: 1,
            content: [{ type: "paragraph", content: [{ type: "text", text: "Body text" }] }],
          },
        },
      ],
    });
    await provider.initialize(CREDENTIALS);
    const board = await provider.getBoard("100");

    expect(board.columns[0].cards[0].body).toBe("Body text");
  });

  it("links an existing issue into a column", async () => {
    const { provider, calls } = makeProvider();
    await provider.initialize(CREDENTIALS);
    await provider.getBoard("100");
    calls.length = 0;
    const card = await provider.linkExternalTask("100", { externalId: "ENG-2" }, "In Progress");

    expect(card.id).toBe("ENG-2");
    expect(
      calls.some(
        (call) => call.method === "POST" && call.path === "/rest/api/3/issue/ENG-2/transitions",
      ),
    ).toBe(true);
  });
});
