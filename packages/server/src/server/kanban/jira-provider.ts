import type { KanbanBoard, KanbanBoardRef, KanbanCard } from "@otto-code/protocol/kanban";
import type {
  KanbanBoardListContext,
  KanbanProvider,
  MutableKanbanProviderConfig,
} from "./types.js";

const DEFAULT_API_BASE_URL = "https://api.atlassian.com/ex/jira";
/** Synthetic column for issues not in any of the board's quick filters. */
export const JIRA_UNASSIGNED_COLUMN_ID = "unassigned";

/**
 * Jira Cloud Kanban provider.
 *
 * Data plane is the Jira Cloud REST v3 API (api.atlassian.com/ex/jira/...).
 *
 * Agnostic mapping (the litmus test: the wire and the UI never see this):
 *   board  = a Jira board (boardId = the Jira board id)
 *   column = one of the board's Quick Filters (column id = the filter id;
 *            column name = the filter name)
 *   card   = a Jira issue on the board (id and rawProviderId = the issue key)
 *   moveCard = restoring an issue into the target Quick Filter via
 *            POST /quickfilter/{filterId}/addIssue (see moveCard below)
 *
 * Quick filters are the closest Jira has to columns: they are saved searches
 * scoped to the board. An issue "moves into" a column by being restored from
 * (added to) that filter; dropping onto the synthetic "Unassigned" column
 * removes the issue from every quick filter it currently matches. Jira has no
 * "set issue to exactly this column" primitive, so a move to a real column is
 * additive (the issue may also still match other filters) — the board read
 * resolves membership by live filter queries, which keeps the UI honest.
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
  self: string;
}

interface RawJiraFilter {
  id: number | string;
  name: string;
}

interface RawJiraIssue {
  key: string;
  self: string;
  fields: {
    summary: string;
    description?: string | null;
    assignee?: { displayName?: string; name?: string } | null;
  };
}

interface BoardLayout {
  filters: RawJiraFilter[];
  /** Project key of the board's issues, derived from the first issue key. */
  projectKey: string;
}

export class JiraKanbanProvider implements KanbanProvider {
  readonly providerId = "jira";

  private readonly fetchImpl: typeof fetch;
  private readonly apiBaseUrl: string;
  private token: string | null = null;
  /** Per-board quick-filter layout, refreshed on every board read. */
  private readonly layoutCache = new Map<string, BoardLayout>();

  constructor(options: JiraKanbanProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.apiBaseUrl = (options.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");
  }

  async initialize(config: MutableKanbanProviderConfig): Promise<void> {
    const token = (config.jiraToken ?? "").trim();
    this.token = token.length > 0 ? token : null;
    if (this.token) {
      // Validate connectivity + auth with the lightest possible call.
      await this.http<RawJiraBoard[]>(`/api/3/board`, { method: "GET" });
    }
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async listBoards(_context: KanbanBoardListContext): Promise<KanbanBoardRef[]> {
    const boards = await this.http<RawJiraBoard[]>(`/api/3/board`, { method: "GET" });
    return boards.map((board) => ({
      providerId: this.providerId,
      boardId: String(board.id),
      title: board.name || "Untitled board",
    }));
  }

  async getBoard(boardId: string): Promise<KanbanBoard> {
    const [board, filters, issues] = await Promise.all([
      this.http<RawJiraBoard>(`/api/3/board/${boardId}`, { method: "GET" }),
      this.http<RawJiraFilter[]>(`/api/3/board/${boardId}/filter`, { method: "GET" }),
      this.http<RawJiraIssue[]>(`/api/3/board/${boardId}/issues?maxResults=100`, {
        method: "GET",
      }),
    ]);
    const layout: BoardLayout = {
      filters,
      projectKey: issues.length > 0 ? issues[0].key.split("-")[0] : boardId,
    };
    this.layoutCache.set(boardId, layout);

    // Live membership: one quick-filter search per filter. A board with no
    // filters (or a fresh board) falls back to the unassigned column alone.
    const membership = await Promise.all(
      filters.map(async (filter) => {
        const members = await this.filterIssueKeys(boardId, filter);
        return { filter, keys: new Set(members) };
      }),
    );

    const assignedKeys = new Set<string>();
    const columns = membership.map(({ filter, keys }) => {
      for (const key of keys) {
        assignedKeys.add(key);
      }
      return {
        id: String(filter.id),
        name: filter.name || "Untitled filter",
        cards: issues
          .filter((issue) => keys.has(issue.key))
          .map((issue) => this.cardFromIssue(issue, filter.name || "Untitled filter")),
      };
    });

    const unassigned = issues.filter((issue) => !assignedKeys.has(issue.key));
    if (unassigned.length > 0) {
      columns.push({
        id: JIRA_UNASSIGNED_COLUMN_ID,
        name: "Unassigned",
        cards: unassigned.map((issue) => this.cardFromIssue(issue, "Unassigned")),
      });
    }

    return {
      id: boardId,
      title: board.name || "Jira Board",
      columns,
    };
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  /**
   * Jira has no "place this issue in exactly this column" primitive. The
   * additive semantics of a Quick Filter are the honest mapping:
   *   - target is a Quick Filter → restore the issue into that filter
   *     (POST quickfilter/{id}/addIssue).
   *   - target is the synthetic "Unassigned" column → remove the issue from
   *     every quick filter it currently matches.
   */
  async moveCard(boardId: string, cardId: string, targetColumnId: string): Promise<void> {
    const layout = this.requireLayout(boardId);
    if (targetColumnId === JIRA_UNASSIGNED_COLUMN_ID) {
      for (const filter of layout.filters) {
        const members = await this.filterIssueKeys(boardId, filter);
        if (members.includes(cardId)) {
          await this.http<unknown>(`/api/3/quickfilter/${filter.id}/removeIssue`, {
            method: "POST",
            body: JSON.stringify({ issue: cardId }),
          });
        }
      }
      return;
    }
    const target = layout.filters.find((filter) => String(filter.id) === targetColumnId);
    if (!target) {
      throw new Error(`Unknown column on this board: ${targetColumnId}`);
    }
    await this.http<unknown>(`/api/3/quickfilter/${target.id}/addIssue`, {
      method: "POST",
      body: JSON.stringify({ issue: cardId }),
    });
    this.layoutCache.delete(boardId);
  }

  async createCard(
    boardId: string,
    columnId: string | null,
    taskData: { title: string; body?: string },
  ): Promise<KanbanCard> {
    const layout = this.requireLayout(boardId);
    const created = await this.http<RawJiraIssue>(`/api/3/issue`, {
      method: "POST",
      body: JSON.stringify({
        fields: {
          project: { key: layout.projectKey },
          summary: taskData.title,
          ...(taskData.body ? { description: taskData.body } : {}),
        },
      }),
    });
    let target: RawJiraFilter | null = null;
    if (columnId && columnId !== JIRA_UNASSIGNED_COLUMN_ID) {
      target = layout.filters.find((filter) => String(filter.id) === columnId) ?? null;
      if (!target) {
        throw new Error(`Unknown column on this board: ${columnId}`);
      }
      await this.http<unknown>(`/api/3/quickfilter/${target.id}/addIssue`, {
        method: "POST",
        body: JSON.stringify({ issue: created.key }),
      });
    }
    const card = this.cardFromIssue(created, target?.name ?? "Unassigned");
    this.layoutCache.delete(boardId);
    return card;
  }

  async linkExternalTask(
    boardId: string,
    external: { owner?: string; repo?: string; externalId: string },
    columnId: string | null,
  ): Promise<KanbanCard> {
    // The external work object is a Jira issue key (or its url). The issue
    // already exists in the Jira site; linking pulls it into the board's view
    // by restoring it from the target quick filter.
    const issue = await this.http<RawJiraIssue>(`/api/3/issue/${external.externalId}`, {
      method: "GET",
    });
    let target: RawJiraFilter | null = null;
    if (columnId && columnId !== JIRA_UNASSIGNED_COLUMN_ID) {
      const layout = this.requireLayout(boardId);
      target = layout.filters.find((filter) => String(filter.id) === columnId) ?? null;
      if (!target) {
        throw new Error(`Unknown column on this board: ${columnId}`);
      }
      await this.http<unknown>(`/api/3/quickfilter/${target.id}/addIssue`, {
        method: "POST",
        body: JSON.stringify({ issue: issue.key }),
      });
      this.layoutCache.delete(boardId);
    }
    return this.cardFromIssue(issue, target?.name ?? "Unassigned");
  }

  dispose(): void {
    this.layoutCache.clear();
    this.token = null;
  }

  // ── Normalization ─────────────────────────────────────────────────────────

  private cardFromIssue(issue: RawJiraIssue, status: string): KanbanCard {
    const assignee = issue.fields.assignee;
    return {
      id: issue.key,
      title: issue.fields.summary || issue.key,
      ...(issue.fields.description ? { body: issue.fields.description } : {}),
      url: issue.self,
      status,
      assignees: assignee ? [assignee.displayName || assignee.name || ""] : [],
      rawProviderId: issue.key,
    };
  }

  private async filterIssueKeys(boardId: string, filter: RawJiraFilter): Promise<string[]> {
    const issues = await this.http<RawJiraIssue[]>(
      `/api/3/board/${boardId}/quickfilter/${filter.id}/search?maxResults=100`,
      { method: "GET" },
    );
    return issues.map((issue) => issue.key);
  }

  private requireLayout(boardId: string): BoardLayout {
    const layout = this.layoutCache.get(boardId);
    if (!layout) {
      throw new Error(
        "Board layout not cached. Call getBoard first — Jira moves need the board's quick filters.",
      );
    }
    return layout;
  }

  // ── HTTP transport ────────────────────────────────────────────────────────

  private async http<TData>(path: string, init: { method: string; body?: string }): Promise<TData> {
    if (!this.token) {
      throw new Error("Jira is not configured: add an API token in the Kanban settings.");
    }
    let response: Response;
    try {
      response = await this.fetchImpl(this.apiBaseUrl + path, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${this.token}`,
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
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`Jira returned an empty response (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "errorMessages" in payload
          ? String((payload as { errorMessages?: unknown[] }).errorMessages?.join("; "))
          : `Jira HTTP ${response.status}`;
      throw new Error(message);
    }
    return payload as TData;
  }
}
