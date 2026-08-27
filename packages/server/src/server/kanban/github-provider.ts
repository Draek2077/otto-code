import type { KanbanBoard, KanbanBoardRef, KanbanCard } from "@otto-code/protocol/kanban";
import {
  KANBAN_REMEDIATION_GITHUB_SCOPES,
  type KanbanRemediation,
} from "@otto-code/protocol/kanban";
import { KanbanRemediationError } from "./kanban-remediation.js";
import type {
  KanbanBoardListContext,
  KanbanProvider,
  MutableKanbanProviderConfig,
} from "./types.js";

const DEFAULT_API_BASE_URL = "https://api.github.com";
const GRAPHQL_PATH = "/graphql";
/** Synthetic column for items whose status field is empty. */
export const GITHUB_UNASSIGNED_COLUMN_ID = "unassigned";

/**
 * GitHub Projects v2 Kanban provider.
 *
 * Data plane is GitHub GraphQL: the REST API (added 2025-09) has no
 * "set item field value" endpoint, and both moveCard and createCard need
 * updateProjectV2ItemFieldValue / addProjectV2ItemToProject. Board reads use
 * one `node(id:)` query that pulls the project, its single-select fields and
 * options, and every item's content + status value in a single round-trip.
 *
 * Agnostic mapping:
 *   board  = ProjectV2 (id is the GraphQL node id; the wire boardId IS the
 *            node id, so deep links work)
 *   column = one option of the project's status single-select field (column
 *            id = the option id; column name = the option name)
 *   card   = a ProjectV2Item whose content is an Issue or PullRequest
 *
 * The `fetch` implementation is injectable so tests run without a network.
 */
export interface GitHubProjectV2ProviderOptions {
  fetch?: typeof fetch;
  apiBaseUrl?: string;
}

interface GitHubGraphQLError {
  message: string;
  type?: string;
  path?: unknown;
}

interface SingleSelectOption {
  id: string;
  name: string;
}

interface ProjectV2StatusField {
  fieldId: string;
  fieldName: string;
  options: SingleSelectOption[];
}

interface IssueOrPullRequestContent {
  __typename: "Issue" | "PullRequest";
  title: string;
  url: string;
  bodyText: string;
  assignees: { nodes: Array<{ login: string }> };
}

interface RawBoardNode {
  id: string;
  title: string;
  url?: string;
}

const VIEWER_QUERY = "query KanbanViewer { viewer { login } }";

const REPO_PROJECTS_QUERY =
  "query KanbanRepoProjects($login: String!, $name: String!) { repository(owner: $login, name: $name) { projectsV2(first: 50) { nodes { id title url } } } }";

const ORG_PROJECTS_QUERY =
  "query KanbanOrgProjects($login: String!) { organization(login: $login) { projectsV2(first: 50) { nodes { id title url } } } }";

const VIEWER_PROJECTS_QUERY =
  "query KanbanViewerProjects { viewer { projectsV2(first: 50) { nodes { id title url } } } }";

const PROJECT_BY_NODE_ID_QUERY =
  "query KanbanProjectByNode($id: ID!) { node(id: $id) { ... on ProjectV2 { id title url } } }";

const PROJECT_BY_NUMBER_QUERY =
  "query KanbanProjectByNumber($login: String!, $number: Int!) { " +
  "organization(login: $login) { projectV2(number: $number) { id title url } } " +
  "user(login: $login) { projectV2(number: $number) { id title url } } }";

const BOARD_QUERY =
  "query KanbanBoard($id: ID!) { node(id: $id) { ... on ProjectV2 { title " +
  "fields(first: 20) { nodes { id name ... on ProjectV2FieldSingleSelect { options(first: 50) { nodes { id name } } } } } " +
  "items(first: 200) { nodes { id " +
  "content { ... on Issue { title url bodyText assignees(first: 10) { nodes { login } } } ... on PullRequest { title url bodyText assignees(first: 10) { nodes { login } } } } " +
  "fieldValues(first: 20) { nodes { ... on ProjectV2ItemFieldSingleSelectValue { name optionId } } } } } } } }";

const MOVE_CARD_MUTATION =
  "mutation KanbanMoveCard($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String) { " +
  "updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId } }) { projectV2Item { id } } }";

const CREATE_CARD_MUTATION =
  "mutation KanbanCreateCard($projectId: ID!, $title: String!, $body: String) { " +
  "addProjectV2ItemToProject(input: { projectId: $projectId, contentKind: ISSUE, title: $title, body: $body }) { " +
  "item { id content { ... on Issue { title url bodyText assignees(first: 10) { nodes { login } } } } } } }";

const CARD_STATUS_MUTATION =
  "mutation KanbanCardStatus($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) { " +
  "updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId } }) { projectV2Item { id } } }";

const RESOLVE_TASK_QUERY =
  "query KanbanResolveTask($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { " +
  "issue(number: $number) { id title url bodyText } pullRequest(number: $number) { id title url bodyText } } }";

const LINK_TASK_MUTATION =
  "mutation KanbanLinkTask($projectId: ID!, $contentId: ID!) { " +
  "addProjectV2ItemToProject(input: { projectId: $projectId, contentId: $contentId }) { " +
  "item { id content { ... on Issue { title url bodyText assignees(first: 10) { nodes { login } } } ... on PullRequest { title url bodyText assignees(first: 10) { nodes { login } } } } } } }";

export class GitHubProjectV2Provider implements KanbanProvider {
  readonly providerId = "github";

  private readonly fetchImpl: typeof fetch;
  private readonly apiBaseUrl: string;
  private token: string | null = null;
  /** Per-board status-field metadata, refreshed on every board read. */
  private readonly statusFieldCache = new Map<string, ProjectV2StatusField | null>();

  constructor(options: GitHubProjectV2ProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.apiBaseUrl = (options.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");
  }

  /**
   * The token is the gh CLI's own credential (see github-cli-token.ts) - the
   * provider never reads a Kanban-specific token, so "not configured" here
   * means the host is signed out of gh, not that a settings field is empty.
   */
  async initialize(config: MutableKanbanProviderConfig): Promise<void> {
    const token = (config.githubToken ?? "").trim();
    this.token = token.length > 0 ? token : null;
    if (this.token) {
      // Validate connectivity + auth with the lightest possible call.
      await this.graphql<{ viewer: { login: string } }>(VIEWER_QUERY);
    }
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async listBoards(context: KanbanBoardListContext): Promise<KanbanBoardRef[]> {
    if (context.targetBoardId) {
      return [await this.resolveConfiguredBoard(context)];
    }
    const owner = context.owner?.trim();
    const repo = context.repo?.trim();
    let query: string;
    let variables: Record<string, unknown>;
    if (owner && repo) {
      query = REPO_PROJECTS_QUERY;
      variables = { login: owner, name: repo };
    } else if (owner) {
      query = ORG_PROJECTS_QUERY;
      variables = { login: owner };
    } else {
      query = VIEWER_PROJECTS_QUERY;
      variables = {};
    }
    const data = await this.graphql<{
      repository?: { projectsV2: { nodes: RawBoardNode[] } } | null;
      organization?: { projectsV2: { nodes: RawBoardNode[] } } | null;
      viewer?: { projectsV2: { nodes: RawBoardNode[] } } | null;
    }>(query, variables);
    const nodes =
      data.repository?.projectsV2?.nodes ??
      data.organization?.projectsV2?.nodes ??
      data.viewer?.projectsV2?.nodes ??
      [];
    return nodes.map((node) => this.boardRef(node));
  }

  async getBoard(boardId: string): Promise<KanbanBoard> {
    const data = await this.graphql<{
      node?: RawBoardProject | { __typename: string } | null;
    }>(BOARD_QUERY, { id: boardId });
    const project = data.node;
    if (!project || !isRawBoardProject(project)) {
      throw new Error(`Board not found: ${boardId}`);
    }
    return this.normalizeBoard(project, boardId);
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  async moveCard(boardId: string, cardId: string, targetColumnId: string): Promise<void> {
    const statusField = this.requireStatusField(boardId);
    // Dropping a card onto the synthetic "Unassigned" column clears the field.
    const option =
      targetColumnId === GITHUB_UNASSIGNED_COLUMN_ID
        ? null
        : statusField.options.find((o) => o.id === targetColumnId);
    if (targetColumnId !== GITHUB_UNASSIGNED_COLUMN_ID && !option) {
      throw new Error(`Unknown column on this board: ${targetColumnId}`);
    }
    await this.graphql<unknown>(MOVE_CARD_MUTATION, {
      projectId: boardId,
      itemId: cardId,
      fieldId: statusField.fieldId,
      ...(option ? { optionId: option.id } : {}),
    });
    this.statusFieldCache.delete(boardId);
  }

  async createCard(
    boardId: string,
    columnId: string | null,
    taskData: { title: string; body?: string },
  ): Promise<KanbanCard> {
    // v1 creates a draft issue as the card; column placement is a second
    // field-value mutation on top (the add mutation has no field input).
    const added = await this.graphql<{
      addProjectV2ItemToProject: { item: { id: string; content: IssueOrPullRequestContent } };
    }>(CREATE_CARD_MUTATION, {
      projectId: boardId,
      title: taskData.title,
      ...(taskData.body ? { body: taskData.body } : {}),
    });
    const item = added.addProjectV2ItemToProject.item;
    const card = this.cardFromItem(item.id, item.content);
    const option = await this.applyColumn(boardId, item.id, columnId);
    if (option) {
      card.status = option.name;
    }
    this.statusFieldCache.delete(boardId);
    return card;
  }

  async linkExternalTask(
    boardId: string,
    external: { owner?: string; repo?: string; externalId: string },
    columnId: string | null,
  ): Promise<KanbanCard> {
    // externalId is either a GraphQL node id (already resolvable) or a numeric
    // issue/PR number; resolve to a node id when a repo context is provided.
    let contentId: string;
    if (/^\d+$/.test(external.externalId) && external.owner && external.repo) {
      const data = await this.graphql<{
        repository?: {
          issue?: { id: string; title: string; url: string; bodyText: string } | null;
          pullRequest?: { id: string; title: string; url: string; bodyText: string } | null;
        } | null;
      }>(RESOLVE_TASK_QUERY, {
        owner: external.owner,
        name: external.repo,
        number: Number(external.externalId),
      });
      const resolved = data.repository?.issue ?? data.repository?.pullRequest;
      if (!resolved) {
        throw new Error(
          `No issue or pull request #${external.externalId} in ${external.owner}/${external.repo}`,
        );
      }
      contentId = resolved.id;
    } else {
      contentId = external.externalId;
    }
    const added = await this.graphql<{
      addProjectV2ItemToProject: { item: { id: string; content: IssueOrPullRequestContent } };
    }>(LINK_TASK_MUTATION, { projectId: boardId, contentId });
    const item = added.addProjectV2ItemToProject.item;
    const card = this.cardFromItem(item.id, item.content);
    const option = await this.applyColumn(boardId, item.id, columnId);
    if (option) {
      card.status = option.name;
    }
    this.statusFieldCache.delete(boardId);
    return card;
  }

  dispose(): void {
    this.statusFieldCache.clear();
    this.token = null;
  }

  // ── Normalization ─────────────────────────────────────────────────────────

  private normalizeBoard(project: RawBoardProject, boardId: string): KanbanBoard {
    const singleSelects = project.fields.nodes.filter(
      (field): field is RawSingleSelectField => field.__typename === "ProjectV2FieldSingleSelect",
    );
    // The status field is the one named "Status"/"State"; fall back to the
    // first single-select so boards with custom names still render.
    const statusField =
      singleSelects.find((f) => /^(status|state)$/i.test(f.name)) ?? singleSelects[0] ?? null;
    this.statusFieldCache.set(
      boardId,
      statusField
        ? {
            fieldId: statusField.id,
            fieldName: statusField.name,
            options: statusField.options.nodes,
          }
        : null,
    );

    const statusOptions: SingleSelectOption[] = statusField ? statusField.options.nodes : [];

    // Build cards keyed by their raw status option id, then project into the
    // agnostic columns. The agnostic card deliberately does not carry the raw
    // option id, so the membership map stays internal to this pass.
    const cardsByOption: Map<string, KanbanCard[]> = new Map();
    const unassigned: KanbanCard[] = [];
    for (const item of project.items.nodes) {
      if (item.content.__typename !== "Issue" && item.content.__typename !== "PullRequest") {
        continue;
      }
      const value = item.fieldValues.nodes.find(
        (valueNode): valueNode is RawSingleSelectValue =>
          valueNode.__typename === "ProjectV2ItemFieldSingleSelectValue",
      );
      const optionId = value?.optionId ?? null;
      const option = optionId ? statusOptions.find((o) => o.id === optionId) : undefined;
      const card = this.cardFromItem(item.id, item.content);
      card.status = option?.name ?? "Unassigned";
      if (option) {
        const bucket = cardsByOption.get(option.id);
        if (bucket) {
          bucket.push(card);
        } else {
          cardsByOption.set(option.id, [card]);
        }
      } else {
        unassigned.push(card);
      }
    }

    const columns = statusOptions.map((option) => ({
      id: option.id,
      name: option.name,
      cards: cardsByOption.get(option.id) ?? [],
    }));
    if (unassigned.length > 0) {
      columns.push({ id: GITHUB_UNASSIGNED_COLUMN_ID, name: "Unassigned", cards: unassigned });
    }
    return { id: boardId, title: project.title || "GitHub Board", columns };
  }

  /**
   * Places a freshly added item into a column. A null columnId or the
   * synthetic Unassigned column leaves the item where the provider put it.
   */
  private async applyColumn(
    boardId: string,
    itemId: string,
    columnId: string | null,
  ): Promise<SingleSelectOption | null> {
    if (!columnId || columnId === GITHUB_UNASSIGNED_COLUMN_ID) {
      return null;
    }
    const statusField = this.requireStatusField(boardId);
    const option = statusField.options.find((o) => o.id === columnId);
    if (!option) {
      throw new Error(`Unknown column on this board: ${columnId}`);
    }
    await this.graphql<unknown>(CARD_STATUS_MUTATION, {
      projectId: boardId,
      itemId,
      fieldId: statusField.fieldId,
      optionId: option.id,
    });
    return option;
  }

  private cardFromItem(
    itemId: string,
    content: IssueOrPullRequestContent | { __typename: string },
  ): KanbanCard {
    if (!isIssueOrPullRequestContent(content)) {
      throw new Error(`Unsupported card content: ${content.__typename}`);
    }
    const issue = content;
    return {
      id: itemId,
      title: issue.title,
      ...(issue.bodyText ? { body: issue.bodyText } : {}),
      url: issue.url,
      status: "",
      assignees: issue.assignees.nodes.map((a) => a.login),
      rawProviderId: itemId,
    };
  }

  private requireStatusField(boardId: string): ProjectV2StatusField {
    const cached = this.statusFieldCache.get(boardId);
    if (!cached) {
      throw new Error(
        "Board layout not cached. Call getBoard first, or the board has no single-select status field.",
      );
    }
    return cached;
  }

  /**
   * Resolves the one board configured for a project. A GraphQL node id already
   * names a board globally; a human-facing board number needs its owning user
   * or organization, preserved from a pasted URL or inferred from the
   * project's GitHub remote by the session resolver.
   */
  private async resolveConfiguredBoard(context: KanbanBoardListContext): Promise<KanbanBoardRef> {
    const targetBoardId = context.targetBoardId;
    if (!targetBoardId) {
      throw new Error("Configured GitHub board id is missing.");
    }
    let board: RawBoardNode | null | undefined;
    if (/^\d+$/.test(targetBoardId)) {
      const owner = context.targetBoardOwner?.trim();
      if (!owner) {
        throw new Error(
          "Configured GitHub board number needs an owner. Paste the board URL in Project Settings, " +
            "or use a project with a GitHub remote.",
        );
      }
      const data = await this.graphql<{
        organization?: { projectV2?: RawBoardNode | null } | null;
        user?: { projectV2?: RawBoardNode | null } | null;
      }>(PROJECT_BY_NUMBER_QUERY, { login: owner, number: Number(targetBoardId) });
      board = data.organization?.projectV2 ?? data.user?.projectV2;
    } else {
      const data = await this.graphql<{ node?: RawBoardNode | null }>(PROJECT_BY_NODE_ID_QUERY, {
        id: targetBoardId,
      });
      board = data.node;
    }
    if (!board) {
      throw new Error(`Configured GitHub board not found: ${targetBoardId}`);
    }
    return this.boardRef(board);
  }

  private boardRef(node: RawBoardNode): KanbanBoardRef {
    return {
      providerId: this.providerId,
      boardId: node.id,
      title: node.title || "Untitled board",
    };
  }

  // ── GraphQL transport ─────────────────────────────────────────────────────

  private async graphql<TData>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<TData> {
    if (!this.token) {
      throw new Error(
        "GitHub is not signed in. Otto uses the GitHub CLI for GitHub: run `gh auth login`, " +
          "then `gh auth refresh -s read:project,project` to grant Projects access.",
      );
    }
    let response: Response;
    try {
      response = await this.fetchImpl(this.apiBaseUrl + GRAPHQL_PATH, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "Otto",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (error) {
      throw new Error(
        `GitHub request failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    let payload: { data?: TData; errors?: GitHubGraphQLError[] };
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      throw new Error(`GitHub returned an empty response (HTTP ${response.status}).`);
    }
    if (!response.ok || (payload.errors && payload.errors.length > 0)) {
      const scopeFailure = describeScopeFailure(payload.errors, response, this.apiBaseUrl);
      if (scopeFailure) {
        // GitHub repeats the same scope complaint once per requested field and
        // signs it off with a link to the personal-access-token page, which is
        // the wrong page for a gh CLI credential. Replace all of it.
        throw new KanbanRemediationError(scopeFailure.message, scopeFailure.remediation);
      }
      const message =
        payload.errors?.map((e) => e.message).join("; ") || `GitHub HTTP ${response.status}`;
      throw new Error(message);
    }
    if (!payload.data) {
      throw new Error("GitHub returned no data.");
    }
    return payload.data;
  }
}

// ── Insufficient-scope detection ───────────────────────────────────────────

/**
 * Projects v2 lives behind its own scope, and the gh CLI's default login grant
 * (`gist`, `read:org`, `repo`, `workflow`) does not include it. GitHub reports
 * that per requested field, so one board read produces three near-identical
 * errors, each ending in a link to the personal access token settings page.
 * That link is a dead end here: Otto sends the gh CLI's OAuth token, which is
 * not a PAT and is not listed on that page. The recovery is `gh auth refresh`,
 * so the daemon detects the shape and hands the client that command instead.
 */
const SCOPE_FAILURE_PATTERN = /has not been granted the required scopes/i;
const SCOPE_REQUIRED_PATTERN = /requires one of the following scopes: \[([^\]]*)\]/g;
const SCOPE_GRANTED_PATTERN = /has only been granted the: \[([^\]]*)\]/;
/** Read and write Projects v2 access, granted in one consent. */
const PROJECT_SCOPES = ["read:project", "project"] as const;
const GH_REFRESH_DOC_URL = "https://cli.github.com/manual/gh_auth_refresh";

function parseScopeList(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((scope) => scope.trim().replace(/^['"]|['"]$/g, ""))
    .filter((scope) => scope.length > 0);
}

/**
 * The gh CLI keys its credentials by host, and a GitHub Enterprise base URL
 * (`https://ghe.example.com/api/v3`) needs `-h ghe.example.com` or the refresh
 * targets github.com instead. The default base needs no flag.
 */
function ghHostFlag(apiBaseUrl: string): string[] {
  let hostname: string;
  try {
    hostname = new URL(apiBaseUrl).hostname;
  } catch {
    return [];
  }
  if (hostname === "api.github.com" || hostname === "github.com") {
    return [];
  }
  return ["-h", hostname.replace(/^api\./, "")];
}

function describeScopeFailure(
  errors: GitHubGraphQLError[] | undefined,
  response: Response,
  apiBaseUrl: string,
): { message: string; remediation: KanbanRemediation } | null {
  const scopeErrors = (errors ?? []).filter(
    (error) => error.type === "INSUFFICIENT_SCOPES" || SCOPE_FAILURE_PATTERN.test(error.message),
  );
  if (scopeErrors.length === 0) {
    return null;
  }
  const joined = scopeErrors.map((error) => error.message).join(" ");
  const required = new Set<string>();
  for (const match of joined.matchAll(SCOPE_REQUIRED_PATTERN)) {
    for (const scope of parseScopeList(match[1])) {
      required.add(scope);
    }
  }
  // The response header is the authoritative granted set; the error text is the
  // fallback for a transport that strips it (a proxy, or a test double).
  const granted = new Set(
    parseScopeList(
      response.headers.get("x-oauth-scopes") ?? SCOPE_GRANTED_PATTERN.exec(joined)?.[1],
    ),
  );
  const missing = [...(required.size > 0 ? required : new Set(PROJECT_SCOPES))].filter(
    (scope) => !granted.has(scope),
  );
  const args = ["auth", "refresh", ...ghHostFlag(apiBaseUrl), "-s", PROJECT_SCOPES.join(",")];
  return {
    message:
      "The GitHub CLI credential is missing Projects access" +
      (missing.length > 0 ? ` (${missing.join(", ")})` : "") +
      ". Otto signs in to GitHub through the gh CLI, so the personal access token page GitHub" +
      " links to does not apply: grant the scopes to the CLI instead.",
    remediation: {
      reason: KANBAN_REMEDIATION_GITHUB_SCOPES,
      ...(missing.length > 0 ? { missingScopes: missing } : {}),
      steps: [{ command: "gh", args, display: `gh ${args.join(" ")}` }],
      url: GH_REFRESH_DOC_URL,
    },
  };
}

// ── Raw GraphQL response shapes (internal to normalization) ────────────────

/**
 * Narrowing guards for the GraphQL response union arms. `__typename` is a
 * literal on the raw interfaces, which TypeScript will not narrow through a
 * `string`-typed sibling arm - explicit guards keep the checks readable.
 */
function isRawBoardProject(
  node: RawBoardProject | { __typename: string },
): node is RawBoardProject {
  return node.__typename === "ProjectV2" && "title" in node;
}

function isIssueOrPullRequestContent(
  content: IssueOrPullRequestContent | { __typename: string },
): content is IssueOrPullRequestContent {
  return (
    (content.__typename === "Issue" || content.__typename === "PullRequest") && "title" in content
  );
}

interface RawSingleSelectField {
  __typename: "ProjectV2FieldSingleSelect";
  id: string;
  name: string;
  options: { nodes: SingleSelectOption[] };
}

interface RawGenericField {
  __typename: string;
  id: string;
  name: string;
}

interface RawSingleSelectValue {
  __typename: "ProjectV2ItemFieldSingleSelectValue";
  name: string;
  optionId: string | null;
}

interface RawGenericValue {
  __typename: string;
}

interface RawBoardItem {
  id: string;
  content: IssueOrPullRequestContent | { __typename: string };
  fieldValues: { nodes: Array<RawSingleSelectValue | RawGenericValue> };
}

interface RawBoardProject {
  __typename: "ProjectV2";
  title: string;
  fields: { nodes: Array<RawSingleSelectField | RawGenericField> };
  items: { nodes: RawBoardItem[] };
}
