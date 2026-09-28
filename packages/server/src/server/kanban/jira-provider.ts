import type {
  KanbanBoardRef,
  KanbanCard,
  KanbanCardFieldValue,
  KanbanField,
  KanbanFieldOption,
  KanbanFieldValueInput,
} from "@otto-code/protocol/kanban";
import type {
  KanbanBoardSnapshot,
  KanbanBoardListContext,
  KanbanCardFieldWrite,
  KanbanCardUpdateResult,
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
    labels?: string[];
    duedate?: string | null;
    priority?: { id?: string; name?: string } | null;
    [key: string]: unknown;
  };
}

interface JiraEditField {
  name?: string;
  schema?: { type?: string; items?: string; custom?: string };
  operations?: string[];
  allowedValues?: Array<{
    id?: string | number;
    accountId?: string;
    name?: string;
    value?: string;
    displayName?: string;
  }>;
}

interface JiraEditMeta {
  fields?: Record<string, JiraEditField>;
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

  async getBoard(boardId: string): Promise<KanbanBoardSnapshot> {
    const [board, configuration, issues, projectPage] = await Promise.all([
      this.http<RawJiraBoard>(`${AGILE_API}/board/${boardId}`, { method: "GET" }),
      this.http<RawJiraBoardConfiguration>(`${AGILE_API}/board/${boardId}/configuration`, {
        method: "GET",
      }),
      this.getBoardIssues(boardId),
      this.http<JiraPage<{ key?: string }>>(`${AGILE_API}/board/${boardId}/project?maxResults=1`, {
        method: "GET",
      }),
    ]);

    const columns: BoardColumn[] = (configuration.columnConfig?.columns ?? []).map((column) => ({
      id: column.name,
      name: column.name || "Untitled column",
      statusIds: new Set((column.statuses ?? []).map((status) => String(status.id))),
    }));
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

    const metadata = new Map<string, JiraEditMeta>();
    // editmeta is issue-specific (screen, permissions, and field context). Read
    // it per card; a board-wide guess could offer writes Jira rejects.
    for (let index = 0; index < issues.length; index += 5) {
      await Promise.all(
        issues.slice(index, index + 5).map(async (issue) => {
          metadata.set(issue.key, await this.getEditMeta(issue.key));
        }),
      );
    }
    const fields = new Map<string, KanbanField>();
    const cardFields: Record<string, KanbanCardFieldValue[]> = {};
    for (const issue of issues) {
      const perCard = jiraFieldsFromMeta(metadata.get(issue.key)!);
      for (const field of perCard) {
        const prior = fields.get(field.id);
        fields.set(field.id, prior?.editable ? prior : field);
      }
    }
    for (const issue of issues) {
      const perCard = new Map(
        jiraFieldsFromMeta(metadata.get(issue.key)!).map((field) => [field.id, field]),
      );
      cardFields[issue.key] = [...fields.values()].map((boardField) => {
        const cardField = perCard.get(boardField.id);
        const value = jiraValue(issue, cardField ?? boardField);
        if (!cardField?.editable && boardField.editable) {
          value.editable = false;
          value.readOnlyReason =
            cardField?.readOnlyReason ?? "Jira does not allow editing this field on this issue.";
        }
        if (cardField?.options) value.options = cardField.options;
        return value;
      });
    }

    return {
      board: {
        id: boardId,
        title: board.name || "Jira Board",
        columns: wireColumns,
      },
      fields: [...fields.values()],
      cardFields,
    };
  }

  async updateCardField(write: KanbanCardFieldWrite): Promise<KanbanCardUpdateResult> {
    const metadata = await this.getEditMeta(write.cardId);
    const field = jiraFieldsFromMeta(metadata).find((candidate) => candidate.id === write.fieldId);
    if (!field?.editable) throw new Error("Jira does not allow editing this field on this issue.");
    const jiraValueToWrite = jiraWriteValue(field, metadata.fields?.[write.fieldId], write.value);
    await this.http<unknown>(`${PLATFORM_API}/issue/${encodeURIComponent(write.cardId)}`, {
      method: "PUT",
      body: JSON.stringify({ fields: { [write.fieldId]: jiraValueToWrite } }),
    });
    const issue = await this.getIssue(write.cardId);
    const layout = this.requireLayout(write.boardId);
    return {
      card: this.cardFromIssue(issue, this.columnNameForIssue(layout, issue)),
      fieldValues: jiraFieldsFromMeta(await this.getEditMeta(write.cardId)).map((entry) =>
        jiraValue(issue, entry),
      ),
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
    }
    const snapshot = await this.getBoard(boardId);
    const card = snapshot.board.columns
      .flatMap((column) => column.cards)
      .find((candidate) => candidate.id === issue.key);
    if (!card)
      throw new Error(
        `Jira did not include ${issue.key} on this board. Check its project and board filter.`,
      );
    return card;
  }

  dispose(): void {
    this.layoutCache.clear();
    this.credentials = null;
  }

  // ── Normalization ─────────────────────────────────────────────────────────

  private getIssue(key: string): Promise<RawJiraIssue> {
    return this.http<RawJiraIssue>(`${PLATFORM_API}/issue/${encodeURIComponent(key)}?fields=*all`, {
      method: "GET",
    });
  }

  private async getBoardIssues(boardId: string): Promise<RawJiraIssue[]> {
    const first = await this.http<{ issues?: RawJiraIssue[]; total?: number }>(
      `${AGILE_API}/board/${boardId}/issue?maxResults=${PAGE_SIZE}&fields=*all`,
      { method: "GET" },
    );
    const issues = [...(first.issues ?? [])];
    for (
      let startAt = issues.length;
      first.total !== undefined && startAt < first.total;
      startAt = issues.length
    ) {
      const page = await this.http<{ issues?: RawJiraIssue[] }>(
        `${AGILE_API}/board/${boardId}/issue?startAt=${startAt}&maxResults=${PAGE_SIZE}&fields=*all`,
        { method: "GET" },
      );
      if (!page.issues?.length)
        throw new Error("Jira stopped paginating this board before all issues were returned.");
      issues.push(...page.issues);
    }
    return issues;
  }

  private getEditMeta(key: string): Promise<JiraEditMeta> {
    return this.http<JiraEditMeta>(`${PLATFORM_API}/issue/${encodeURIComponent(key)}/editmeta`, {
      method: "GET",
    });
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

const JIRA_FIELD_KINDS: Record<string, string> = {
  summary: "text",
  description: "richText",
  assignee: "users",
  labels: "labels",
  duedate: "date",
  priority: "singleSelect",
};
const JIRA_SCHEMA_KINDS: Record<string, string> = {
  string: "text",
  number: "number",
  date: "date",
  option: "singleSelect",
};

function jiraWriteValue(
  field: KanbanField,
  raw: JiraEditField | undefined,
  value: KanbanFieldValueInput,
): unknown {
  if (value.kind === "clear") return null;
  if (value.kind === "text") {
    if (field.kind === "text") return value.text;
    if (field.kind === "richText") return toAtlassianDocument(value.text);
  }
  if (value.kind === "number" && field.kind === "number") return value.number;
  if (value.kind === "date" && field.kind === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value.date))
    return value.date;
  if (value.kind === "options") {
    if (field.kind === "labels") return value.optionIds;
    if (value.optionIds.length === 1 && field.kind === "users")
      return { accountId: value.optionIds[0] };
    if (value.optionIds.length === 1 && field.kind === "singleSelect") {
      if (!raw?.allowedValues?.some((choice) => String(choice.id) === value.optionIds[0]))
        throw new Error("That Jira choice is no longer available for this issue.");
      return { id: value.optionIds[0] };
    }
  }
  throw new Error(`Invalid value for Jira field ${field.name}.`);
}

function jiraFieldsFromMeta(metadata: JiraEditMeta): KanbanField[] {
  return Object.entries(metadata.fields ?? {}).flatMap(([id, raw]): KanbanField[] => {
    // Jira Cloud's textarea custom fields use ADF even though editmeta calls
    // their schema type "string". Sending plain text would reject the update.
    const kind = raw.schema?.custom?.endsWith(":textarea")
      ? "richText"
      : (JIRA_FIELD_KINDS[id] ?? JIRA_SCHEMA_KINDS[raw.schema?.type ?? ""]);
    if (!kind) return [];
    const choices: KanbanFieldOption[] = (raw.allowedValues ?? []).flatMap((choice) => {
      const optionId = choice.accountId ?? (choice.id === undefined ? null : String(choice.id));
      const name = choice.displayName ?? choice.name ?? choice.value;
      return optionId && name ? [{ id: optionId, name }] : [];
    });
    const hasChoices = (kind !== "singleSelect" && kind !== "users") || choices.length > 0;
    const editable = (raw.operations ?? []).includes("set") && hasChoices;
    const field: KanbanField = {
      id,
      name: raw.name ?? id,
      kind,
      editable,
      ...(kind === "labels" ? { allowCustomOptions: true } : {}),
    };
    if (!editable)
      field.readOnlyReason = hasChoices
        ? "Jira does not allow setting this field on this issue."
        : "Jira did not provide choices for this field.";
    if (choices.length) field.options = choices;
    return [field];
  });
}

function jiraValue(issue: RawJiraIssue, field: KanbanField): KanbanCardFieldValue {
  const raw = issue.fields[field.id];
  const result: KanbanCardFieldValue = { fieldId: field.id, display: "" };
  if (raw === null || raw === undefined || raw === "") return result;
  if (field.kind === "richText") {
    result.display = fromAtlassianDocument(raw);
    result.value = { kind: "text", text: result.display };
  } else if (field.kind === "text" && typeof raw === "string") {
    result.display = raw;
    result.value = { kind: "text", text: raw };
  } else if (field.kind === "number" && typeof raw === "number") {
    result.display = String(raw);
    result.value = { kind: "number", number: raw };
  } else if (field.kind === "date" && typeof raw === "string") {
    result.display = raw;
    result.value = { kind: "date", date: raw };
  } else if (field.kind === "labels" && Array.isArray(raw)) {
    const labels = raw.filter((entry): entry is string => typeof entry === "string");
    result.display = labels.join(", ");
    result.value = { kind: "options", optionIds: labels };
    result.options = labels.map((label) => ({ id: label, name: label }));
  } else if (typeof raw === "object" && !Array.isArray(raw)) return jiraChoiceValue(field.id, raw);
  return result;
}

function jiraChoiceValue(fieldId: string, raw: object): KanbanCardFieldValue {
  const choice = raw as {
    id?: string | number;
    accountId?: string;
    name?: string;
    displayName?: string;
    value?: string;
  };
  const result: KanbanCardFieldValue = {
    fieldId,
    display: choice.displayName ?? choice.name ?? choice.value ?? "",
  };
  const id = choice.accountId ?? (choice.id === undefined ? null : String(choice.id));
  if (id) result.value = { kind: "options", optionIds: [id] };
  return result;
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
