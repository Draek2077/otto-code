import type { KanbanBoard, KanbanBoardRef, KanbanCard } from "@otto-code/protocol/kanban";
import type {
  KanbanBoardListContext,
  KanbanProvider,
  MutableKanbanProviderConfig,
} from "./types.js";

/** Jira Cloud REST prefixes. Boards are Agile; issues are the platform API. */
const AGILE_API = "/rest/agile/1.0";
const PLATFORM_API = "/rest/api/3";
const PAGE_SIZE = 100;
/** Synthetic column for issues whose status maps to no board column. */
export const JIRA_UNASSIGNED_COLUMN_ID = "unassigned";

/**
 * Jira Cloud Kanban provider.
 *
 * Auth is the shared Atlassian account credential (email + API token over HTTP
 * Basic) that Bitbucket git hosting already uses - Kanban authors no token of
 * its own. Calls are addressed to the user's own site
 * (https://acme.atlassian.net/rest/...) rather than the api.atlassian.com
 * gateway, which is OAuth-only and would need a cloudId lookup.
 *
 * Agnostic mapping (the litmus test: the wire and the UI never see this):
 *   board  = a Jira board (boardId = the Jira board id)
 *   column = a column of the board's configuration (column id = the column
 *            name, which Jira keeps unique per board; a column owns a set of
 *            issue statuses)
 *   card   = an issue on the board (id and rawProviderId = the issue key)
 *   moveCard = transitioning the issue into one of the target column's statuses
 *
 * Columns are the board's real column configuration, not quick filters. A Jira
 * board column *is* a set of statuses, so "which column is this card in" is
 * answered by the issue's own status - one board read, no per-column queries -
 * and a move is an ordinary workflow transition. Quick filters cannot express
 * either: they are saved JQL searches with no membership to write to.
 *
 * The `fetch` implementation is injectable so tests run without a network.
 */
export interface JiraKanbanProviderOptions {
  fetch?: typeof fetch;
  apiBaseUrl?: string;
}

interface RawJiraBoard {
  id: number | string;
  name: string;
  self?: string;
}

interface JiraPage<T> {
  values?: T[];
}

interface RawJiraBoardConfiguration {
  columnConfig?: {
    columns?: Array<{
      name: string;
      statuses?: Array<{ id: string | number }>;
    }>;
  };
}

interface RawJiraIssue {
  key: string;
  self: string;
  fields: {
    summary: string;
    description?: unknown;
    status?: { id?: string | number; name?: string } | null;
    assignee?: { displayName?: string; name?: string } | null;
  };
}

interface RawJiraTransition {
  id: string;
  to?: { id?: string | number };
}

interface BoardColumn {
  /** Wire column id. The Jira column name, unique per board. */
  id: string;
  name: string;
  /** Status ids this column owns, as strings. */
  statusIds: Set<string>;
}

interface BoardLayout {
  columns: BoardColumn[];
  /** Project key for issue creation, from the board's project. */
  projectKey: string;
}

export class JiraKanbanProvider implements KanbanProvider {
  readonly providerId = "jira";

  private readonly fetchImpl: typeof fetch;
  private readonly apiBaseUrlOverride: string | null;
  private credentials: { basic: string; siteUrl: string } | null = null;
  /** Per-board column layout, refreshed on every board read. */
  private readonly layoutCache = new Map<string, BoardLayout>();

  constructor(options: JiraKanbanProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    // Tests pin a base URL; in production it is the user's own Jira site, which
    // is only known once credentials resolve.
    this.apiBaseUrlOverride = options.apiBaseUrl ? options.apiBaseUrl.replace(/\/$/, "") : null;
  }

  private get apiBaseUrl(): string {
    return this.apiBaseUrlOverride ?? this.credentials?.siteUrl ?? "";
  }

  /**
   * Credentials are the shared Atlassian account pair (email + API token), the
   * same one Bitbucket git hosting uses. The site URL is required because
   * Basic-auth Jira Cloud is site-addressed.
   */
  async initialize(config: MutableKanbanProviderConfig): Promise<void> {
    const email = (config.atlassianEmail ?? "").trim();
    const apiToken = (config.atlassianApiToken ?? "").trim();
    const siteUrl = (config.jiraSiteUrl ?? "").trim().replace(/\/$/, "");
    const configured = email.length > 0 && apiToken.length > 0 && siteUrl.length > 0;
    this.credentials = configured
      ? { basic: Buffer.from(`${email}:${apiToken}`).toString("base64"), siteUrl }
      : null;
    this.layoutCache.clear();
    if (this.credentials) {
      // Validate connectivity + auth with the lightest possible call.
      await this.http<JiraPage<RawJiraBoard>>(`${AGILE_API}/board?maxResults=1`, { method: "GET" });
    }
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async listBoards(context: KanbanBoardListContext): Promise<KanbanBoardRef[]> {
    if (context.targetBoardId) {
      const board = await this.http<RawJiraBoard>(`${AGILE_API}/board/${context.targetBoardId}`, {
        method: "GET",
      });
      return [this.boardRef(board)];
    }
    const page = await this.http<JiraPage<RawJiraBoard>>(
      `${AGILE_API}/board?maxResults=${PAGE_SIZE}`,
      { method: "GET" },
    );
    return (page.values ?? []).map((board) => this.boardRef(board));
  }

  async getBoard(boardId: string): Promise<KanbanBoard> {
    const [board, configuration, issuePage, projectPage] = await Promise.all([
      this.http<RawJiraBoard>(`${AGILE_API}/board/${boardId}`, { method: "GET" }),
      this.http<RawJiraBoardConfiguration>(`${AGILE_API}/board/${boardId}/configuration`, {
        method: "GET",
      }),
      this.http<{ issues?: RawJiraIssue[] }>(
        `${AGILE_API}/board/${boardId}/issue?maxResults=${PAGE_SIZE}` +
          `&fields=summary,description,status,assignee`,
        { method: "GET" },
      ),
      this.http<JiraPage<{ key?: string }>>(`${AGILE_API}/board/${boardId}/project?maxResults=1`, {
        method: "GET",
      }),
    ]);

    const columns: BoardColumn[] = (configuration.columnConfig?.columns ?? []).map((column) => ({
      id: column.name,
      name: column.name || "Untitled column",
      statusIds: new Set((column.statuses ?? []).map((status) => String(status.id))),
    }));
    const issues = issuePage.issues ?? [];
    this.layoutCache.set(boardId, {
      columns,
      projectKey: projectPage.values?.[0]?.key ?? issues[0]?.key.split("-")[0] ?? "",
    });

    // The issue's own status decides its column - no per-column query needed.
    const placed = new Set<string>();
    const wireColumns = columns.map((column) => {
      const cards = issues.filter((issue) => {
        const statusId = issue.fields.status?.id;
        if (statusId === undefined || !column.statusIds.has(String(statusId))) {
          return false;
        }
        placed.add(issue.key);
        return true;
      });
      return {
        id: column.id,
        name: column.name,
        cards: cards.map((issue) => this.cardFromIssue(issue, column.name)),
      };
    });

    // Jira allows statuses that belong to no column; those issues would
    // otherwise vanish from a board the user can see them on in Jira.
    const unplaced = issues.filter((issue) => !placed.has(issue.key));
    if (unplaced.length > 0) {
      wireColumns.push({
        id: JIRA_UNASSIGNED_COLUMN_ID,
        name: "Unassigned",
        cards: unplaced.map((issue) => this.cardFromIssue(issue, "Unassigned")),
      });
    }

    return {
      id: boardId,
      title: board.name || "Jira Board",
      columns: wireColumns,
    };
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  /**
   * A move is a workflow transition into one of the target column's statuses.
   * Jira workflows genuinely forbid some transitions, so a column the user can
   * see is not always a column they can move this issue to - that surfaces as
   * an explicit error rather than a silent no-op.
   */
  async moveCard(boardId: string, cardId: string, targetColumnId: string): Promise<void> {
    const layout = this.requireLayout(boardId);
    if (targetColumnId === JIRA_UNASSIGNED_COLUMN_ID) {
      throw new Error(
        "Unassigned is not a real Jira column - it holds issues whose status maps to no column. " +
          "Move the issue to a column that exists on the board instead.",
      );
    }
    const column = layout.columns.find((candidate) => candidate.id === targetColumnId);
    if (!column) {
      throw new Error(`Unknown column on this board: ${targetColumnId}`);
    }
    const transitions = await this.http<{ transitions?: RawJiraTransition[] }>(
      `${PLATFORM_API}/issue/${cardId}/transitions`,
      { method: "GET" },
    );
    const match = (transitions.transitions ?? []).find(
      (transition) =>
        transition.to?.id !== undefined && column.statusIds.has(String(transition.to.id)),
    );
    if (!match) {
      throw new Error(
        `Jira has no available transition from this issue's current status into "${column.name}".`,
      );
    }
    await this.http<unknown>(`${PLATFORM_API}/issue/${cardId}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: { id: match.id } }),
    });
    this.layoutCache.delete(boardId);
  }

  async createCard(
    boardId: string,
    columnId: string | null,
    taskData: { title: string; body?: string },
  ): Promise<KanbanCard> {
    const layout = this.requireLayout(boardId);
    if (!layout.projectKey) {
      throw new Error("This Jira board has no project to create the issue in.");
    }
    const created = await this.http<{ key: string }>(`${PLATFORM_API}/issue`, {
      method: "POST",
      body: JSON.stringify({
        fields: {
          project: { key: layout.projectKey },
          issuetype: { name: "Task" },
          summary: taskData.title,
          ...(taskData.body ? { description: toAtlassianDocument(taskData.body) } : {}),
        },
      }),
    });
    // The create response carries only ids; re-read so the card reflects the
    // status Jira actually assigned (the workflow's initial status).
    const issue = await this.getIssue(created.key);
    if (columnId && columnId !== JIRA_UNASSIGNED_COLUMN_ID) {
      await this.moveCard(boardId, issue.key, columnId);
      return this.cardFromIssue(issue, columnId);
    }
    this.layoutCache.delete(boardId);
    return this.cardFromIssue(issue, this.columnNameForIssue(layout, issue));
  }

  async linkExternalTask(
    boardId: string,
    external: { owner?: string; repo?: string; externalId: string },
    columnId: string | null,
  ): Promise<KanbanCard> {
    // The external work object is a Jira issue key. It already exists in the
    // site; "linking" means placing it in the requested column.
    const issue = await this.getIssue(external.externalId);
    if (columnId && columnId !== JIRA_UNASSIGNED_COLUMN_ID) {
      await this.moveCard(boardId, issue.key, columnId);
      return this.cardFromIssue(issue, columnId);
    }
    return this.cardFromIssue(issue, this.columnNameForIssue(this.requireLayout(boardId), issue));
  }

  dispose(): void {
    this.layoutCache.clear();
    this.credentials = null;
  }

  // ── Normalization ─────────────────────────────────────────────────────────

  private getIssue(key: string): Promise<RawJiraIssue> {
    return this.http<RawJiraIssue>(
      `${PLATFORM_API}/issue/${key}?fields=summary,description,status,assignee`,
      { method: "GET" },
    );
  }

  private columnNameForIssue(layout: BoardLayout, issue: RawJiraIssue): string {
    const statusId = issue.fields.status?.id;
    if (statusId === undefined) {
      return "Unassigned";
    }
    const column = layout.columns.find((candidate) => candidate.statusIds.has(String(statusId)));
    return column?.name ?? "Unassigned";
  }

  private cardFromIssue(issue: RawJiraIssue, status: string): KanbanCard {
    const assignee = issue.fields.assignee;
    const body = fromAtlassianDocument(issue.fields.description);
    return {
      id: issue.key,
      title: issue.fields.summary || issue.key,
      ...(body ? { body } : {}),
      // The browse URL, not `self`: `self` is the REST endpoint, which is not
      // something a user can open.
      url: this.apiBaseUrl ? `${this.apiBaseUrl}/browse/${issue.key}` : issue.self,
      status,
      assignees: assignee ? [assignee.displayName || assignee.name || ""] : [],
      rawProviderId: issue.key,
    };
  }

  private boardRef(board: RawJiraBoard): KanbanBoardRef {
    return {
      providerId: this.providerId,
      boardId: String(board.id),
      title: board.name || "Untitled board",
    };
  }

  private requireLayout(boardId: string): BoardLayout {
    const layout = this.layoutCache.get(boardId);
    if (!layout) {
      throw new Error(
        "Board layout not cached. Call getBoard first — Jira moves need the board's columns.",
      );
    }
    return layout;
  }

  // ── HTTP transport ────────────────────────────────────────────────────────

  private async http<TData>(path: string, init: { method: string; body?: string }): Promise<TData> {
    if (!this.credentials) {
      throw new Error(
        "Jira is not configured: add your Atlassian account email, API token, and Jira site URL " +
          "in Settings under the Atlassian provider.",
      );
    }
    let response: Response;
    try {
      response = await this.fetchImpl(this.apiBaseUrl + path, {
        method: init.method,
        headers: {
          // Jira Cloud takes the Atlassian account email + API token as HTTP
          // Basic - the same credential Bitbucket git hosting uses. (Bearer is
          // for OAuth access tokens through api.atlassian.com, which we do not
          // use: it needs a cloudId the user would have to look up.)
          Authorization: `Basic ${this.credentials.basic}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
        ...(init.body ? { body: init.body } : {}),
      });
    } catch (error) {
      throw new Error(
        `Jira request failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    // Transitions return 204 with no body; parsing that is not an error.
    if (response.status === 204) {
      return undefined as TData;
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      if (response.ok) {
        return undefined as TData;
      }
      throw new Error(`Jira returned an empty response (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      throw new Error(jiraErrorMessage(payload, response.status));
    }
    return payload as TData;
  }
}

function jiraErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const messages = (payload as { errorMessages?: unknown }).errorMessages;
    if (Array.isArray(messages) && messages.length > 0) {
      return messages.map(String).join("; ");
    }
    const errors = (payload as { errors?: Record<string, unknown> }).errors;
    if (errors && typeof errors === "object") {
      const entries = Object.entries(errors);
      if (entries.length > 0) {
        return entries.map(([field, message]) => `${field}: ${String(message)}`).join("; ");
      }
    }
  }
  if (status === 401 || status === 403) {
    return `Jira rejected the credentials (HTTP ${status}). Check the Atlassian email, API token, and token scopes.`;
  }
  return `Jira HTTP ${status}`;
}

/**
 * Jira's platform API v3 speaks Atlassian Document Format, not plain text. We
 * only ever author a plain-text body, so a single paragraph per line is a
 * faithful encoding.
 */
function toAtlassianDocument(text: string): unknown {
  return {
    type: "doc",
    version: 1,
    // An empty line is a paragraph with no content; ADF rejects an empty
    // `content` array, so the key is omitted rather than set to [].
    content: text
      .split(/\r?\n/)
      .map((line) =>
        line.length > 0
          ? { type: "paragraph", content: [{ type: "text", text: line }] }
          : { type: "paragraph" },
      ),
  };
}

/** Flattens an ADF document back to plain text, tolerating any node shape. */
function fromAtlassianDocument(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  const node = value as { type?: string; text?: string; content?: unknown };
  if (typeof node.text === "string") {
    return node.text;
  }
  if (!Array.isArray(node.content)) {
    return "";
  }
  const parts = node.content.map((child) => fromAtlassianDocument(child));
  // Block-level nodes read as separate lines; inline runs concatenate.
  return node.type === "doc" || node.type === "paragraph"
    ? parts.join(node.type === "doc" ? "\n" : "")
    : parts.join("");
}
