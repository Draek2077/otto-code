import type {
  KanbanBoard,
  KanbanBoardRef,
  KanbanCard,
  KanbanCardFieldValue,
  KanbanFieldOption,
} from "@otto-code/protocol/kanban";
import {
  KANBAN_REMEDIATION_GITHUB_SCOPES,
  type KanbanRemediation,
} from "@otto-code/protocol/kanban";
import { KanbanRemediationError } from "./kanban-remediation.js";
import type {
  KanbanBoardListContext,
  KanbanBoardSnapshot,
  KanbanCardFieldWrite,
  KanbanCardUpdateResult,
  KanbanProvider,
  MutableKanbanProviderConfig,
} from "./types.js";
import {
  buildBoardFields,
  buildCardFieldValues,
  toLabelOption,
  planCardFieldWrite,
  type GitHubBoardField,
  type GitHubCardContent,
  type GitHubRepoOptions,
  type RawFieldDefinition,
  type RawFieldValue,
} from "./github-card-fields.js";

const DEFAULT_API_BASE_URL = "https://api.github.com";
const GRAPHQL_PATH = "/graphql";
/** Synthetic column for items whose status field is empty. */
export const GITHUB_UNASSIGNED_COLUMN_ID = "unassigned";

/**
 * GitHub Projects v2 Kanban provider.
 *
 * Data plane is GitHub GraphQL: the REST API (added 2025-09) has no
 * "set item field value" endpoint, and both moveCard and createCard need
 * updateProjectV2ItemFieldValue / addProjectV2DraftIssue.
 *
 * Agnostic mapping:
 *   board  = ProjectV2 (id is the GraphQL node id; the wire boardId IS the
 *            node id, so deep links work)
 *   column = one option of the project's status single-select field (column
 *            id = the option id; column name = the option name)
 *   card   = a ProjectV2Item whose content is a DraftIssue, Issue or PullRequest
 *
 * Three things about Projects v2 GraphQL are counter-intuitive enough that
 * getting them wrong produces a document GitHub rejects before it ever
 * executes, so they are stated once here and referenced by the documents below:
 *
 *  1. `ProjectV2.fields` yields the `ProjectV2FieldConfiguration` *union*
 *     (ProjectV2Field | ProjectV2IterationField | ProjectV2MultiSelectField |
 *     ProjectV2SingleSelectField). A union carries no fields of its own, so
 *     `id` and `name` must be read through the `ProjectV2FieldCommon`
 *     interface and can never be selected directly.
 *  2. The single-select type is `ProjectV2SingleSelectField`, and its `options`
 *     is a plain list rather than a Relay connection: `options { id name }`,
 *     with no `first:` argument and no `nodes` wrapper.
 *  3. `__typename` comes back only when it is asked for. Every narrowing in
 *     this file reads it, so every union and interface selection requests it.
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

/**
 * A board's cached layout: its title, the status field driving columns, and the
 * raw field definitions. Definitions are kept because a field write needs the
 * field's `dataType` to pick its route, and that must not require a board read.
 */
interface ProjectV2Layout {
  title: string;
  statusField: ProjectV2StatusField | null;
  definitions: RawFieldDefinition[];
}

/**
 * Where a card's content lives, cached per board so a write can address the
 * work item without re-reading the whole board.
 */
interface CardContentRef {
  typename: "DraftIssue" | "Issue" | "PullRequest";
  contentId: string;
  repositoryId?: string;
}

/** The project item content arms that carry a user-facing URL. */
interface IssueOrPullRequestContent {
  __typename: "Issue" | "PullRequest";
  /** The work item's own node id, which the content mutations address. */
  id: string;
  title: string;
  url: string;
  bodyText: string;
  assignees: { nodes: Array<{ id: string; login: string }>; pageInfo?: { hasNextPage: boolean } };
  labels?: {
    nodes: Array<{ id: string; name: string; color?: string | null }>;
    pageInfo?: { hasNextPage: boolean };
  } | null;
  repository?: { id: string; nameWithOwner: string } | null;
}

/** A draft issue lives only inside the project, so it has no URL to open. */
interface DraftIssueContent {
  __typename: "DraftIssue";
  id: string;
  title: string;
  bodyText: string;
  assignees: { nodes: Array<{ id: string; login: string }>; pageInfo?: { hasNextPage: boolean } };
}

type ProjectItemContent = DraftIssueContent | IssueOrPullRequestContent;

function hasOverflowContent(content: ProjectItemContent | { __typename: string }): boolean {
  if (!isProjectItemContent(content)) return false;
  return (
    content.assignees.pageInfo?.hasNextPage === true ||
    ("labels" in content && content.labels?.pageInfo?.hasNextPage === true)
  );
}

interface RawBoardNode {
  id: string;
  title: string;
  url?: string;
}

/**
 * Read page sizes. Items are the only selection that grows without bound on a
 * real board, so they paginate; fields and per-item field values are bounded by
 * how many columns and fields a human configures.
 */
const ITEM_PAGE_SIZE = 100;
const MAX_ITEM_PAGES = 20;
const FIELD_PAGE_SIZE = 100;
const MAX_FIELD_PAGES = 5;
/** Field values per item. An item carries one value per populated field. */
const ITEM_FIELD_VALUE_PAGE_SIZE = 100;
/**
 * How many of a board's repositories contribute assignee and label options. A
 * board spanning more than this many repositories is unusual, and the cap keeps
 * one board read from turning into an unbounded option fetch.
 */
const MAX_OPTION_REPOSITORIES = 20;

const VIEWER_QUERY = "query KanbanViewer { viewer { login } }";

const REPO_PROJECTS_QUERY =
  "query KanbanRepoProjects($login: String!, $name: String!) { repository(owner: $login, name: $name) { projectsV2(first: 50) { nodes { id title url } } } }";

const ORG_PROJECTS_QUERY =
  "query KanbanOrgProjects($login: String!) { organization(login: $login) { projectsV2(first: 50) { nodes { id title url } } } }";

const VIEWER_PROJECTS_QUERY =
  "query KanbanViewerProjects { viewer { projectsV2(first: 50) { nodes { id title url } } } }";

const PROJECT_BY_NODE_ID_QUERY =
  "query KanbanProjectByNode($id: ID!) { node(id: $id) { __typename ... on ProjectV2 { id title url } } }";

const PROJECT_BY_NUMBER_QUERY =
  "query KanbanProjectByNumber($login: String!, $number: Int!) { " +
  "organization(login: $login) { projectV2(number: $number) { id title url } } " +
  "user(login: $login) { projectV2(number: $number) { id title url } } }";

/**
 * One project item's content.
 *
 * Shared by the board read and by every mutation that answers with a card, so a
 * created, linked or edited card normalizes through exactly the same path as a
 * card that was read. A draft issue has no `url` and no `repository`, and cannot
 * carry labels, so that arm asks for none of them.
 *
 * `id` here is the *work item's* node id, which is what the content mutations
 * address - distinct from the project item id that the field mutations take.
 */
const CONTENT_SELECTION =
  "content { __typename " +
  "... on DraftIssue { id title bodyText assignees(first: 100) { pageInfo { hasNextPage } nodes { id login } } } " +
  "... on Issue { id title url bodyText assignees(first: 100) { pageInfo { hasNextPage } nodes { id login } } " +
  "labels(first: 100) { pageInfo { hasNextPage } nodes { id name color } } repository { id nameWithOwner } } " +
  "... on PullRequest { id title url bodyText assignees(first: 100) { pageInfo { hasNextPage } nodes { id login } } " +
  "labels(first: 100) { pageInfo { hasNextPage } nodes { id name color } } repository { id nameWithOwner } } }";

/** A field value's owning field id, read through the field union's interface. */
const VALUE_FIELD_SELECTION = "field { ... on ProjectV2FieldCommon { id } }";

/**
 * A card's project field values.
 *
 * Only the six `ProjectV2CustomFieldType` arms are read here. Title, assignees
 * and labels are built-in fields whose values also appear in this list, but they
 * are read from the item's own content instead: content is where they are
 * authoritative, it is already fetched for the card, and it carries the node ids
 * a write needs (a login is not an assignee id).
 */
const FIELD_VALUES_SELECTION =
  `fieldValues(first: ${ITEM_FIELD_VALUE_PAGE_SIZE}) { pageInfo { hasNextPage } nodes { __typename ` +
  `... on ProjectV2ItemFieldTextValue { text ${VALUE_FIELD_SELECTION} } ` +
  `... on ProjectV2ItemFieldNumberValue { number ${VALUE_FIELD_SELECTION} } ` +
  `... on ProjectV2ItemFieldDateValue { date ${VALUE_FIELD_SELECTION} } ` +
  `... on ProjectV2ItemFieldSingleSelectValue { optionId name ${VALUE_FIELD_SELECTION} } ` +
  `... on ProjectV2ItemFieldMultiSelectValue { options { id name } ${VALUE_FIELD_SELECTION} } ` +
  `... on ProjectV2ItemFieldIterationValue { iterationId title ${VALUE_FIELD_SELECTION} } } }`;

/**
 * The board's shape: its title and every field its cards carry. Separate from
 * the item read so a mutation can resolve a field without pulling every card,
 * and so item paging stays one cursor.
 *
 * Schema shape: notes 1 and 2 above - the field union is read through
 * ProjectV2FieldCommon, single-select `options` takes no arguments, and
 * multi-select choices live under `multiSelectOptions` rather than `options`,
 * which is the same trap wearing a different name.
 */
const BOARD_LAYOUT_QUERY =
  "query KanbanBoardLayout($id: ID!, $fieldCursor: String) { node(id: $id) { __typename " +
  "... on ProjectV2 { title " +
  `fields(first: ${FIELD_PAGE_SIZE}, after: $fieldCursor) { pageInfo { hasNextPage endCursor } nodes { __typename ` +
  "... on ProjectV2FieldCommon { id name dataType } " +
  "... on ProjectV2SingleSelectField { options { id name } } " +
  "... on ProjectV2MultiSelectField { multiSelectOptions { id name } } " +
  "... on ProjectV2IterationField { configuration { iterations { id title } completedIterations { id title } } } " +
  "} } } } }";

/**
 * One page of board items.
 *
 * Schema shape: `content` is the ProjectV2ItemContent union (DraftIssue | Issue
 * | PullRequest). `fieldValues` is the ProjectV2ItemFieldValue union, and a
 * value's `field` is itself the ProjectV2FieldConfiguration union, so its id
 * comes through ProjectV2FieldCommon. That id is what binds a value to a field:
 * a board with several single-selects (Status and Priority) would otherwise
 * place cards by whichever value happened to come back first.
 */
const BOARD_ITEMS_QUERY =
  "query KanbanBoardItems($id: ID!, $itemCursor: String) { node(id: $id) { __typename " +
  "... on ProjectV2 { " +
  `items(first: ${ITEM_PAGE_SIZE}, after: $itemCursor) { pageInfo { hasNextPage endCursor } nodes { id ` +
  `${CONTENT_SELECTION} ${FIELD_VALUES_SELECTION} } } } } }`;

/**
 * The people and labels a card can take, per repository.
 *
 * `nodes(ids:)` answers for every repository on the board in one request, which
 * matters because a label id belongs to exactly one repository: the labels a
 * card can be given are its own repository's, not the board's union.
 */
const REPO_OPTIONS_QUERY =
  "query KanbanRepoOptions($ids: [ID!]!) { nodes(ids: $ids) { __typename ... on Repository { id " +
  "assignableUsers(first: 100) { pageInfo { hasNextPage } nodes { id login name } } " +
  "labels(first: 100) { pageInfo { hasNextPage } nodes { id name color } } } } }";

/**
 * A cheap marker for "has this board changed?".
 *
 * `updatedAt` alone is not trusted: it is not documented to move for every
 * field write, so the item count rides along and the poller re-reads the board
 * on a slower interval regardless. A missed change costs latency, never
 * correctness, because the client always re-reads rather than patching.
 */
const BOARD_REVISION_QUERY =
  "query KanbanBoardRevision($id: ID!) { node(id: $id) { __typename " +
  "... on ProjectV2 { updatedAt items(first: 1) { totalCount } } } }";

const SET_CARD_STATUS_MUTATION =
  "mutation KanbanSetCardStatus($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) { " +
  "updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId } }) { projectV2Item { id } } }";

/**
 * Emptying a field is its own mutation: `ProjectV2FieldValue` rejects an input
 * with no value set, so a null `singleSelectOptionId` cannot express "clear".
 */
const CLEAR_CARD_STATUS_MUTATION =
  "mutation KanbanClearCardStatus($projectId: ID!, $itemId: ID!, $fieldId: ID!) { " +
  "clearProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId }) { projectV2Item { id } } }";

/**
 * Creating a card creates a draft issue, the only work item a project can
 * author without naming a repository. Schema shape: the payload field is
 * `projectItem`, not the `item` that addProjectV2ItemById returns.
 */
const CREATE_CARD_MUTATION =
  "mutation KanbanCreateCard($projectId: ID!, $title: String!, $body: String) { " +
  "addProjectV2DraftIssue(input: { projectId: $projectId, title: $title, body: $body }) { " +
  `projectItem { id ${CONTENT_SELECTION} } } }`;

/**
 * Writes any project field.
 *
 * One mutation covers all six writable kinds because `ProjectV2FieldValue` rides
 * as a variable: its six members (text, number, date, singleSelectOptionId,
 * multiSelectOptionIds, iterationId) are exactly the `ProjectV2CustomFieldType`
 * set, so the plan picks the member and the document never changes.
 */
const SET_CARD_FIELD_MUTATION =
  "mutation KanbanSetCardField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) { " +
  "updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value }) { projectV2Item { id } } }";

const CLEAR_CARD_FIELD_MUTATION =
  "mutation KanbanClearCardField($projectId: ID!, $itemId: ID!, $fieldId: ID!) { " +
  "clearProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId }) { projectV2Item { id } } }";

/**
 * The three content writes. Title, description, assignees and labels live on the
 * work item, not on the project, so each content type needs its own mutation -
 * and a draft issue has no labels to write.
 */
const UPDATE_DRAFT_MUTATION =
  "mutation KanbanUpdateDraft($id: ID!, $title: String, $body: String, $assigneeIds: [ID!]) { " +
  "updateProjectV2DraftIssue(input: { draftIssueId: $id, title: $title, body: $body, assigneeIds: $assigneeIds }) { " +
  "draftIssue { id } } }";

const UPDATE_ISSUE_MUTATION =
  "mutation KanbanUpdateIssue($id: ID!, $title: String, $body: String, $assigneeIds: [ID!], $labelIds: [ID!]) { " +
  "updateIssue(input: { id: $id, title: $title, body: $body, assigneeIds: $assigneeIds, labelIds: $labelIds }) { " +
  "issue { id } } }";

const UPDATE_PULL_REQUEST_MUTATION =
  "mutation KanbanUpdatePullRequest($id: ID!, $title: String, $body: String, $assigneeIds: [ID!], $labelIds: [ID!]) { " +
  "updatePullRequest(input: { pullRequestId: $id, title: $title, body: $body, assigneeIds: $assigneeIds, labelIds: $labelIds }) { " +
  "pullRequest { id } } }";

/**
 * Removes the card from the board.
 *
 * This deletes the *project item*, which is board-scoped: a linked issue leaves
 * the board and survives in its repository, while a draft issue - which only
 * ever existed inside the project - is gone.
 */
const DELETE_CARD_MUTATION =
  "mutation KanbanDeleteCard($projectId: ID!, $itemId: ID!) { " +
  "deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) { deletedItemId } }";

/**
 * Reads one card. Used to reconcile after a write, and to resolve a card a
 * mutation names before any board read has cached it.
 */
const CARD_QUERY =
  "query KanbanCard($id: ID!) { node(id: $id) { __typename ... on ProjectV2Item { id " +
  `${CONTENT_SELECTION} ${FIELD_VALUES_SELECTION} } } }`;

const RESOLVE_TASK_QUERY =
  "query KanbanResolveTask($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { " +
  "issue(number: $number) { id title url bodyText } pullRequest(number: $number) { id title url bodyText } } }";

/** Schema shape: the mutation is addProjectV2ItemById, and its payload is `item`. */
const LINK_TASK_MUTATION =
  "mutation KanbanLinkTask($projectId: ID!, $contentId: ID!) { " +
  "addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { " +
  `item { id ${CONTENT_SELECTION} } } }`;

export class GitHubProjectV2Provider implements KanbanProvider {
  readonly providerId = "github";

  private readonly fetchImpl: typeof fetch;
  private readonly apiBaseUrl: string;
  private token: string | null = null;
  /**
   * Per-board layout, read on demand and refreshed by every board read. A card
   * mutation does not change it, so it deliberately survives one: dragging two
   * cards in a row must not depend on a board refresh landing in between.
   */
  private readonly layoutCache = new Map<string, ProjectV2Layout>();
  /**
   * Where each card's work item lives, per board. A content write addresses the
   * work item, not the project item, so it needs this; a card that is not here
   * yet is read on demand rather than treated as an error.
   */
  private readonly cardContentCache = new Map<string, Map<string, CardContentRef>>();
  /**
   * Per-repository assignable people and labels, per board. Cached because the
   * options for a board do not move between two edits of the same card, and a
   * fresh board read refreshes them.
   */
  private readonly repoOptionsCache = new Map<string, Map<string, GitHubRepoOptions>>();

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
    // A new credential can see a different set of boards, so nothing the old
    // one resolved survives the rotation.
    this.clearCaches();
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

  async getBoard(boardId: string): Promise<KanbanBoardSnapshot> {
    const layout = await this.readLayout(boardId);
    const items = await this.readItems(boardId);
    this.indexCardContent(boardId, items);
    // Field options need the board's repositories, and the board's repositories
    // are only known once its items are read, so this is the one ordering the
    // read can take.
    const repoOptions = await this.readRepoOptions(boardId, items);
    const fields = this.buildFields(layout, repoOptions);
    const board = this.normalizeBoard(boardId, layout, items);
    const cardFields: Record<string, KanbanCardFieldValue[]> = {};
    for (const item of items) {
      const content = toCardContent(item.content);
      if (!content) {
        continue;
      }
      cardFields[item.id] = buildCardFieldValues({
        fields,
        content,
        values: item.fieldValues.nodes as RawFieldValue[],
        repoOptions: content.repositoryId ? (repoOptions.get(content.repositoryId) ?? null) : null,
      });
    }
    return { board, fields: fields.map((entry) => entry.field), cardFields };
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  async moveCard(boardId: string, cardId: string, targetColumnId: string): Promise<void> {
    const statusField = await this.requireStatusField(boardId);
    // Dropping a card onto the synthetic "Unassigned" column empties the field.
    if (targetColumnId === GITHUB_UNASSIGNED_COLUMN_ID) {
      await this.graphql<unknown>(CLEAR_CARD_STATUS_MUTATION, {
        projectId: boardId,
        itemId: cardId,
        fieldId: statusField.fieldId,
      });
      return;
    }
    const option = statusField.options.find((o) => o.id === targetColumnId);
    if (!option) {
      throw new Error(`Unknown column on this board: ${targetColumnId}`);
    }
    await this.graphql<unknown>(SET_CARD_STATUS_MUTATION, {
      projectId: boardId,
      itemId: cardId,
      fieldId: statusField.fieldId,
      optionId: option.id,
    });
  }

  async createCard(
    boardId: string,
    columnId: string | null,
    taskData: { title: string; body?: string },
  ): Promise<KanbanCard> {
    // v1 creates a draft issue as the card; column placement is a second
    // field-value mutation on top (the add mutation has no field input).
    const added = await this.graphql<{
      addProjectV2DraftIssue: { projectItem: { id: string; content: ProjectItemContent } };
    }>(CREATE_CARD_MUTATION, {
      projectId: boardId,
      title: taskData.title,
      ...(taskData.body ? { body: taskData.body } : {}),
    });
    const item = added.addProjectV2DraftIssue.projectItem;
    const card = this.cardFromItem(item.id, item.content);
    const option = await this.applyColumn(boardId, item.id, columnId);
    if (option) {
      card.status = option.name;
    }
    return card;
  }

  async linkExternalTask(
    boardId: string,
    external: { owner?: string; repo?: string; externalId: string },
    columnId: string | null,
  ): Promise<KanbanCard> {
    // externalId is either a GraphQL node id (already resolvable) or a numeric
    // issue/PR number; a GitHub issue/PR URL carries its own repository context.
    const url = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)\/?$/.exec(
      external.externalId,
    );
    if (url) external = { owner: url[1], repo: url[2], externalId: url[3] };
    let contentId: string;
    if (/^\d+$/.test(external.externalId)) {
      if (!external.owner || !external.repo) {
        // Guessing a repository here would silently link an unrelated issue
        // that happens to share the number.
        throw new Error(
          `Linking issue #${external.externalId} needs a repository, and this project has no ` +
            "GitHub remote Otto can read. Paste the issue or pull request URL instead of its number.",
        );
      }
      const data = await this.graphql<{
        repository?: {
          issue?: { id: string; title: string; url: string; bodyText: string } | null;
          pullRequest?: { id: string; title: string; url: string; bodyText: string } | null;
        } | null;
      }>(
        RESOLVE_TASK_QUERY,
        {
          owner: external.owner,
          name: external.repo,
          number: Number(external.externalId),
        },
        // A number names an issue or a pull request, never both, so GitHub
        // always reports NOT_FOUND for the other half alongside the real data.
        { ignoreNotFoundAt: ["repository.issue", "repository.pullRequest"] },
      );
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
      addProjectV2ItemById: { item: { id: string; content: ProjectItemContent } };
    }>(LINK_TASK_MUTATION, { projectId: boardId, contentId });
    const item = added.addProjectV2ItemById.item;
    const card = this.cardFromItem(item.id, item.content);
    const option = await this.applyColumn(boardId, item.id, columnId);
    if (option) {
      card.status = option.name;
    }
    return card;
  }

  /**
   * Writes one field, then re-reads the card.
   *
   * Reconciling from provider truth rather than echoing the request back is what
   * makes an edit trustworthy: GitHub normalizes some values (it trims a title,
   * and it silently drops an assignee who has lost repository access), and the
   * card the caller renders has to be the card GitHub now holds.
   */
  async updateCardField(write: KanbanCardFieldWrite): Promise<KanbanCardUpdateResult> {
    const { boardId, cardId, fieldId, value } = write;
    const fields = await this.resolveBoardFields(boardId);
    const entry = fields.find((candidate) => candidate.field.id === fieldId);
    if (!entry) {
      throw new Error(`This board has no field ${fieldId}.`);
    }
    const plan = planCardFieldWrite(entry, value);
    if (plan.target === "clearProjectField") {
      await this.graphql<unknown>(CLEAR_CARD_FIELD_MUTATION, {
        projectId: boardId,
        itemId: cardId,
        fieldId,
      });
    } else if (plan.target === "projectField") {
      await this.graphql<unknown>(SET_CARD_FIELD_MUTATION, {
        projectId: boardId,
        itemId: cardId,
        fieldId,
        value: { [plan.key]: plan.value },
      });
    } else {
      await this.writeContent(boardId, cardId, plan.patch);
    }
    return this.readCard(boardId, cardId);
  }

  /**
   * Removes a card from its board.
   *
   * Board-scoped by construction: `deleteProjectV2Item` detaches the work item
   * from the project, so a linked issue survives in its repository and only a
   * draft issue - which existed nowhere else - is actually destroyed.
   */
  async deleteCard(boardId: string, cardId: string): Promise<void> {
    await this.graphql<unknown>(DELETE_CARD_MUTATION, { projectId: boardId, itemId: cardId });
    this.cardContentCache.get(boardId)?.delete(cardId);
  }

  /**
   * A cheap marker that moves when the board changes.
   *
   * `updatedAt` is not documented to move for every field write, so the item
   * count rides along to catch additions and removals it might miss. The poller
   * treats this as a hint and re-reads the board on a slower interval anyway.
   */
  async readBoardRevision(boardId: string): Promise<string | null> {
    const data = await this.graphql<{ node?: RawRevisionProject | { __typename: string } | null }>(
      BOARD_REVISION_QUERY,
      { id: boardId },
    );
    const project = data.node;
    if (!project || project.__typename !== "ProjectV2" || !("updatedAt" in project)) {
      return null;
    }
    return `${project.updatedAt}:${project.items.totalCount}`;
  }

  dispose(): void {
    this.clearCaches();
    this.token = null;
  }

  private clearCaches(): void {
    this.layoutCache.clear();
    this.cardContentCache.clear();
    this.repoOptionsCache.clear();
  }

  // ── Field writes ──────────────────────────────────────────────────────────

  /**
   * Sends a content patch to the mutation its content type accepts.
   *
   * Three mutations rather than one because the work items are three different
   * types, and a draft issue takes no labels at all - which is caught before the
   * request so the user reads Otto's explanation rather than GitHub's.
   */
  private async writeContent(
    boardId: string,
    cardId: string,
    patch: { title?: string; body?: string; assigneeIds?: string[]; labelIds?: string[] },
  ): Promise<void> {
    const ref = await this.resolveCardContent(boardId, cardId);
    if (ref.typename === "DraftIssue") {
      if (patch.labelIds) {
        throw new Error(
          "A draft issue has no repository, so it cannot carry labels until it is converted to an issue.",
        );
      }
      await this.graphql<unknown>(UPDATE_DRAFT_MUTATION, { id: ref.contentId, ...patch });
      return;
    }
    const mutation =
      ref.typename === "Issue" ? UPDATE_ISSUE_MUTATION : UPDATE_PULL_REQUEST_MUTATION;
    await this.graphql<unknown>(mutation, { id: ref.contentId, ...patch });
  }

  /** Reads one card and its field values, as the provider now holds them. */
  private async readCard(boardId: string, cardId: string): Promise<KanbanCardUpdateResult> {
    const data = await this.graphql<{ node?: RawCardNode | { __typename: string } | null }>(
      CARD_QUERY,
      { id: cardId },
    );
    const node = data.node;
    if (!node || node.__typename !== "ProjectV2Item" || !("content" in node)) {
      throw new Error(`Card not found: ${cardId}`);
    }
    if (node.fieldValues.pageInfo?.hasNextPage) {
      throw new Error(
        `This card has more than ${ITEM_FIELD_VALUE_PAGE_SIZE} field values, which Otto cannot read completely.`,
      );
    }
    if (hasOverflowContent(node.content)) {
      throw new Error(
        "This card has more than 100 assignees or labels, which Otto cannot read completely.",
      );
    }
    const content = toCardContent(node.content);
    if (!content) {
      throw new Error("Unsupported card content.");
    }
    this.rememberCardContent(boardId, node.id, content);
    const layout = this.layoutCache.get(boardId) ?? (await this.readLayout(boardId));
    const repoOptions = this.repoOptionsCache.get(boardId) ?? new Map<string, GitHubRepoOptions>();
    const fields = this.buildFields(layout, repoOptions);
    const card = this.cardFromItem(node.id, node.content);
    card.status = this.statusNameOf(layout, node.fieldValues.nodes as RawFieldValue[]);
    return {
      card,
      fieldValues: buildCardFieldValues({
        fields,
        content,
        values: node.fieldValues.nodes as RawFieldValue[],
        repoOptions: content.repositoryId ? (repoOptions.get(content.repositoryId) ?? null) : null,
      }),
    };
  }

  /** The clear-text status of a card, from its status field value. */
  private statusNameOf(layout: ProjectV2Layout, values: readonly RawFieldValue[]): string {
    const statusField = layout.statusField;
    if (!statusField) {
      return "Unassigned";
    }
    const value = values.find(
      (candidate) =>
        candidate.__typename === "ProjectV2ItemFieldSingleSelectValue" &&
        candidate.field?.id === statusField.fieldId,
    );
    const option = value?.optionId
      ? statusField.options.find((candidate) => candidate.id === value.optionId)
      : undefined;
    return option?.name ?? "Unassigned";
  }

  /**
   * The board's fields and their write routes.
   *
   * Built from the cached layout, so a write never needs a board read. Option
   * lists come from whatever repository options are cached: a write's route does
   * not depend on them, and a read has always populated them first.
   */
  private async resolveBoardFields(boardId: string): Promise<GitHubBoardField[]> {
    const layout = this.layoutCache.get(boardId) ?? (await this.readLayout(boardId));
    return this.buildFields(
      layout,
      this.repoOptionsCache.get(boardId) ?? new Map<string, GitHubRepoOptions>(),
    );
  }

  private buildFields(
    layout: ProjectV2Layout,
    repoOptions: Map<string, GitHubRepoOptions>,
  ): GitHubBoardField[] {
    return buildBoardFields({
      definitions: layout.definitions,
      statusFieldId: layout.statusField?.fieldId ?? null,
      allRepoOptions: unionRepoOptions(repoOptions),
    });
  }

  private async resolveCardContent(boardId: string, cardId: string): Promise<CardContentRef> {
    const cached = this.cardContentCache.get(boardId)?.get(cardId);
    if (cached) {
      return cached;
    }
    // Reading the one card is cheaper than re-reading the board, and a write can
    // legitimately arrive before any read (an agent acting through the tools).
    await this.readCard(boardId, cardId);
    const resolved = this.cardContentCache.get(boardId)?.get(cardId);
    if (!resolved) {
      throw new Error(`Card not found on this board: ${cardId}`);
    }
    return resolved;
  }

  private indexCardContent(boardId: string, items: readonly RawBoardItem[]): void {
    const index = new Map<string, CardContentRef>();
    for (const item of items) {
      const content = toCardContent(item.content);
      if (content) {
        index.set(item.id, {
          typename: content.typename,
          contentId: content.contentId,
          ...(content.repositoryId ? { repositoryId: content.repositoryId } : {}),
        });
      }
    }
    this.cardContentCache.set(boardId, index);
  }

  private rememberCardContent(boardId: string, cardId: string, content: GitHubCardContent): void {
    const index = this.cardContentCache.get(boardId) ?? new Map<string, CardContentRef>();
    index.set(cardId, {
      typename: content.typename,
      contentId: content.contentId,
      ...(content.repositoryId ? { repositoryId: content.repositoryId } : {}),
    });
    this.cardContentCache.set(boardId, index);
  }

  /**
   * Reads the assignable people and labels for every repository on the board.
   *
   * One request for all of them: `nodes(ids:)` takes the whole set, and the
   * per-repository split matters because a label id belongs to exactly one
   * repository. A board with no linked issues (all drafts) needs no request.
   */
  private async readRepoOptions(
    boardId: string,
    items: readonly RawBoardItem[],
  ): Promise<Map<string, GitHubRepoOptions>> {
    const ids = new Set<string>();
    for (const item of items) {
      const repositoryId = toCardContent(item.content)?.repositoryId;
      if (repositoryId) {
        ids.add(repositoryId);
      }
    }
    const options = new Map<string, GitHubRepoOptions>();
    if (ids.size === 0) {
      this.repoOptionsCache.set(boardId, options);
      return options;
    }
    if (ids.size > MAX_OPTION_REPOSITORIES) {
      throw new Error(
        `This board spans more than ${MAX_OPTION_REPOSITORIES} repositories, so Otto cannot read every label and assignee option.`,
      );
    }
    const data = await this.graphql<{ nodes?: Array<RawRepositoryNode | null> | null }>(
      REPO_OPTIONS_QUERY,
      { ids: [...ids] },
    );
    for (const node of data.nodes ?? []) {
      const entry = toRepositoryOptions(node);
      if (entry) options.set(entry.id, entry.options);
    }
    this.repoOptionsCache.set(boardId, options);
    return options;
  }

  // ── Board reads ───────────────────────────────────────────────────────────

  /**
   * Reads and caches the board's title and status field. Field pages are
   * followed because the status field can sit behind any number of custom
   * fields, and missing it silently collapses the whole board into one column.
   */
  private async readLayout(boardId: string): Promise<ProjectV2Layout> {
    const fields: RawFieldDefinition[] = [];
    let title = "";
    let cursor: string | null = null;
    let hasMore = false;
    for (let page = 0; page < MAX_FIELD_PAGES; page += 1) {
      const data: RawLayoutResponse = await this.graphql<RawLayoutResponse>(BOARD_LAYOUT_QUERY, {
        id: boardId,
        ...(cursor ? { fieldCursor: cursor } : {}),
      });
      const project = data.node;
      if (!project || !isRawLayoutProject(project)) {
        throw new Error(`Board not found: ${boardId}`);
      }
      title = project.title;
      fields.push(...project.fields.nodes);
      hasMore = project.fields.pageInfo.hasNextPage;
      if (!hasMore) {
        break;
      }
      if (!project.fields.pageInfo.endCursor)
        throw new Error("GitHub returned another field page without a cursor.");
      cursor = project.fields.pageInfo.endCursor;
    }
    if (hasMore)
      throw new Error(
        `This board has more than ${MAX_FIELD_PAGES * FIELD_PAGE_SIZE} fields, which Otto cannot read completely.`,
      );

    const singleSelects = fields.filter(
      (field) => field.__typename === "ProjectV2SingleSelectField",
    );
    // A different single-select such as Priority is never a status column.
    const statusField = singleSelects.find((f) => /^(status|state)$/i.test(f.name)) ?? null;
    const layout: ProjectV2Layout = {
      title,
      statusField: statusField
        ? {
            fieldId: statusField.id,
            fieldName: statusField.name,
            options: statusField.options ?? [],
          }
        : null,
      definitions: fields,
    };
    this.layoutCache.set(boardId, layout);
    return layout;
  }

  /**
   * Reads every item page. The page cap keeps a misbehaving cursor from looping
   * forever; a board that really is larger than the cap is reported as such
   * rather than quietly served as its first few pages.
   */
  private async readItems(boardId: string): Promise<RawBoardItem[]> {
    const items: RawBoardItem[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_ITEM_PAGES; page += 1) {
      const data: RawItemsResponse = await this.graphql<RawItemsResponse>(BOARD_ITEMS_QUERY, {
        id: boardId,
        ...(cursor ? { itemCursor: cursor } : {}),
      });
      const project = data.node;
      if (!project || !isRawItemsProject(project)) {
        throw new Error(`Board not found: ${boardId}`);
      }
      items.push(...project.items.nodes);
      if (project.items.nodes.some((item) => item.fieldValues.pageInfo?.hasNextPage)) {
        throw new Error(
          `A card has more than ${ITEM_FIELD_VALUE_PAGE_SIZE} field values, which Otto cannot read completely.`,
        );
      }
      if (project.items.nodes.some((item) => hasOverflowContent(item.content))) {
        throw new Error(
          "A card has more than 100 assignees or labels, which Otto cannot read completely.",
        );
      }
      if (!project.items.pageInfo.hasNextPage) {
        return items;
      }
      if (!project.items.pageInfo.endCursor)
        throw new Error("GitHub returned another item page without a cursor.");
      cursor = project.items.pageInfo.endCursor;
    }
    throw new Error(
      `This board holds more than ${MAX_ITEM_PAGES * ITEM_PAGE_SIZE} items, which is more than Otto ` +
        "reads in one board load. Narrow the board's items in GitHub, or track the overflow there.",
    );
  }

  // ── Normalization ─────────────────────────────────────────────────────────

  private normalizeBoard(
    boardId: string,
    layout: ProjectV2Layout,
    items: RawBoardItem[],
  ): KanbanBoard {
    const statusField = layout.statusField;
    const statusOptions: SingleSelectOption[] = statusField ? statusField.options : [];

    // Build cards keyed by their raw status option id, then project into the
    // agnostic columns. The agnostic card deliberately does not carry the raw
    // option id, so the membership map stays internal to this pass.
    const cardsByOption: Map<string, KanbanCard[]> = new Map();
    const unassigned: KanbanCard[] = [];
    for (const item of items) {
      if (!isProjectItemContent(item.content)) {
        continue;
      }
      // Only the status field's own value decides a column: on a board with a
      // second single-select, any value would otherwise do.
      const value = statusField
        ? item.fieldValues.nodes.find(
            (valueNode) =>
              valueNode.__typename === "ProjectV2ItemFieldSingleSelectValue" &&
              valueNode.field?.id === statusField.fieldId,
          )
        : undefined;
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
    return { id: boardId, title: layout.title || "GitHub Board", columns };
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
    const statusField = await this.requireStatusField(boardId);
    const option = statusField.options.find((o) => o.id === columnId);
    if (!option) {
      throw new Error(`Unknown column on this board: ${columnId}`);
    }
    await this.graphql<unknown>(SET_CARD_STATUS_MUTATION, {
      projectId: boardId,
      itemId,
      fieldId: statusField.fieldId,
      optionId: option.id,
    });
    return option;
  }

  private cardFromItem(
    itemId: string,
    content: ProjectItemContent | { __typename: string },
  ): KanbanCard {
    if (!isProjectItemContent(content)) {
      throw new Error(`Unsupported card content: ${content.__typename}`);
    }
    return {
      id: itemId,
      title: content.title,
      ...(content.bodyText ? { body: content.bodyText } : {}),
      // A draft issue exists only inside the project, so there is nothing to
      // open externally and the wire field stays absent rather than empty.
      ...("url" in content && content.url ? { url: content.url } : {}),
      status: "",
      assignees: content.assignees.nodes.map((a) => a.login),
      rawProviderId: itemId,
    };
  }

  /**
   * The status field for a board, read on demand. A mutation arriving before
   * any board read - or after the cache was dropped on credential rotation - is
   * ordinary, so this fetches the layout rather than failing.
   */
  private async requireStatusField(boardId: string): Promise<ProjectV2StatusField> {
    const layout = this.layoutCache.get(boardId) ?? (await this.readLayout(boardId));
    if (!layout.statusField) {
      throw new Error(
        "This board has no single-select status field, so Otto cannot place cards in columns. " +
          "Add a Status field to the project in GitHub.",
      );
    }
    return layout.statusField;
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
      }>(
        PROJECT_BY_NUMBER_QUERY,
        { login: owner, number: Number(targetBoardId) },
        // A login is either an organization or a user, never both, so GitHub
        // always reports NOT_FOUND for the other half alongside the real data.
        { ignoreNotFoundAt: ["organization", "user"] },
      );
      board = data.organization?.projectV2 ?? data.user?.projectV2;
    } else {
      const data = await this.graphql<{ node?: RawNodeIdentity | null }>(PROJECT_BY_NODE_ID_QUERY, {
        id: targetBoardId,
      });
      const node = data.node;
      // A node id that resolves to something other than a project answers the
      // ProjectV2 fragment with an empty object, which would otherwise become a
      // board ref with no id at all.
      if (node && node.__typename !== "ProjectV2") {
        throw new Error(
          `Configured GitHub board id is not a project: ${targetBoardId} is a ${node.__typename}.`,
        );
      }
      board = node && node.id ? { id: node.id, title: node.title ?? "" } : null;
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
    options: { ignoreNotFoundAt?: readonly string[] } = {},
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
    const ignored = options.ignoreNotFoundAt ?? [];
    const errors = payload.errors?.filter(
      (error) => !(error.type === "NOT_FOUND" && isIgnoredErrorPath(error.path, ignored)),
    );
    payload = { ...payload, ...(errors ? { errors } : {}) };
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

/**
 * Whether a GraphQL error path is one the caller already expects to be absent.
 *
 * Prefixes are dotted paths, so the missing half of a two-in-one query
 * (`repository.pullRequest`) can be tolerated as precisely as a top-level one.
 */
function isIgnoredErrorPath(path: unknown, prefixes: readonly string[]): boolean {
  if (!Array.isArray(path) || prefixes.length === 0) {
    return false;
  }
  const joined = path.map((segment) => String(segment)).join(".");
  return prefixes.some((prefix) => joined === prefix || joined.startsWith(`${prefix}.`));
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
function isRawLayoutProject(
  node: RawLayoutProject | { __typename: string },
): node is RawLayoutProject {
  return node.__typename === "ProjectV2" && "fields" in node;
}

function isRawItemsProject(
  node: RawItemsProject | { __typename: string },
): node is RawItemsProject {
  return node.__typename === "ProjectV2" && "items" in node;
}

function isProjectItemContent(
  content: ProjectItemContent | { __typename: string },
): content is ProjectItemContent {
  return (
    (content.__typename === "DraftIssue" ||
      content.__typename === "Issue" ||
      content.__typename === "PullRequest") &&
    "title" in content
  );
}

/**
 * Projects the raw content union onto the shape the field mapper reads. Returns
 * null for a content type this provider does not model, which the callers treat
 * the same way they treat a card they cannot render: skip it.
 */
function toCardContent(
  content: ProjectItemContent | { __typename: string },
): GitHubCardContent | null {
  if (!isProjectItemContent(content)) {
    return null;
  }
  const labels = "labels" in content ? (content.labels?.nodes ?? []) : [];
  const repositoryId = "repository" in content ? content.repository?.id : undefined;
  return {
    typename: content.__typename,
    contentId: content.id,
    title: content.title,
    bodyText: content.bodyText,
    assignees: content.assignees.nodes.map((user) => ({ id: user.id, name: user.login })),
    labels: labels.map(toLabelOption),
    ...(repositoryId ? { repositoryId } : {}),
  };
}

/**
 * The board-wide option lists, for fields whose choices are not card-specific.
 *
 * Deduplicated by id: the same person is assignable in several of a board's
 * repositories, and offering them once per repository would be noise.
 */
function unionRepoOptions(perRepository: Map<string, GitHubRepoOptions>): GitHubRepoOptions {
  const assignableUsers = new Map<string, KanbanFieldOption>();
  const labels = new Map<string, KanbanFieldOption>();
  for (const options of perRepository.values()) {
    for (const user of options.assignableUsers) {
      assignableUsers.set(user.id, user);
    }
    for (const label of options.labels) {
      labels.set(label.id, label);
    }
  }
  return { assignableUsers: [...assignableUsers.values()], labels: [...labels.values()] };
}

/** `node(id:)` answers with the type name plus whatever the fragment matched. */
interface RawNodeIdentity {
  __typename: string;
  id?: string;
  title?: string;
  url?: string;
}

interface RawPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface RawBoardItem {
  id: string;
  content: ProjectItemContent | { __typename: string };
  fieldValues: { nodes: RawFieldValue[]; pageInfo?: { hasNextPage: boolean } };
}

/** `node(id:)` on a project item, for the single-card read. */
interface RawCardNode {
  __typename: string;
  id: string;
  content: ProjectItemContent | { __typename: string };
  fieldValues: { nodes: RawFieldValue[]; pageInfo?: { hasNextPage: boolean } };
}

interface RawRevisionProject {
  __typename: "ProjectV2";
  updatedAt: string;
  items: { totalCount: number };
}

interface RawRepositoryNode {
  __typename: string;
  id?: string;
  assignableUsers?: {
    nodes: Array<{ id: string; login: string }>;
    pageInfo?: { hasNextPage: boolean };
  } | null;
  labels?: {
    nodes: Array<{ id: string; name: string; color?: string | null }>;
    pageInfo?: { hasNextPage: boolean };
  } | null;
}

function toRepositoryOptions(
  node: RawRepositoryNode | null,
): { id: string; options: GitHubRepoOptions } | null {
  if (!node || node.__typename !== "Repository" || !node.id) return null;
  if (node.assignableUsers?.pageInfo?.hasNextPage || node.labels?.pageInfo?.hasNextPage) {
    throw new Error(
      `Repository ${node.id} has more than 100 assignable users or labels, so Otto cannot show every choice.`,
    );
  }
  return {
    id: node.id,
    options: {
      assignableUsers: (node.assignableUsers?.nodes ?? []).map((user) => ({
        id: user.id,
        name: user.login,
      })),
      labels: (node.labels?.nodes ?? []).map(toLabelOption),
    },
  };
}

/**
 * Named so the paged reads can annotate their response. Inferring it inside the
 * loop makes the page cursor circular: the cursor feeds the next request, whose
 * response produces the cursor.
 */
interface RawLayoutResponse {
  node?: RawLayoutProject | { __typename: string } | null;
}

interface RawItemsResponse {
  node?: RawItemsProject | { __typename: string } | null;
}

interface RawLayoutProject {
  __typename: "ProjectV2";
  title: string;
  fields: { pageInfo: RawPageInfo; nodes: RawFieldDefinition[] };
}

interface RawItemsProject {
  __typename: "ProjectV2";
  items: { pageInfo: RawPageInfo; nodes: RawBoardItem[] };
}
