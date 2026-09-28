import type {
  KanbanBoard,
  KanbanBoardRef,
  KanbanCard,
  KanbanCardFieldValue,
  KanbanField,
  KanbanFieldValueInput,
} from "@otto-code/protocol/kanban";

/**
 * One board read: its columns, the fields its cards carry, and each card's
 * values.
 *
 * Fields come back with the board rather than from a second call because a
 * provider reads them in the same round trip, and because a field's editability
 * is a property of this board's configuration - not of the provider in general.
 * A provider that exposes no editable fields answers with an empty list, which
 * the UI renders as "this board has no fields Otto can edit" rather than as an
 * absence of information.
 */
export interface KanbanBoardSnapshot {
  board: KanbanBoard;
  fields: KanbanField[];
  /** Field values keyed by card id. A card with no values may be omitted. */
  cardFields: Record<string, KanbanCardFieldValue[]>;
}

/** What a provider reports after writing one field. */
export interface KanbanCardUpdateResult {
  card: KanbanCard;
  fieldValues: KanbanCardFieldValue[];
}

export interface KanbanCardFieldWrite {
  boardId: string;
  cardId: string;
  fieldId: string;
  value: KanbanFieldValueInput;
}

/**
 * The Kanban service provider interface (SPI).
 *
 * Every tracking backend (GitHub Projects v2, Jira, ...) implements this and
 * registers itself in kanban-registry.ts. The daemon controller and the
 * protocol never reference a provider's native concepts: ids and status keys
 * are opaque strings, and `rawProviderId` carries the provider's native
 * identifier for deep links. A provider that cannot do an operation returns
 * `null` (list) or throws a plain Error (mutations); the session translates
 * that into a wire error - no provider-specific error types cross this line.
 *
 * Jira maps boards to Jira boards, columns to their configured status groups,
 * and a move to an ordinary issue workflow transition. The wire and UI stay
 * provider-neutral.
 */
export interface KanbanProvider {
  /** Provider id used on the wire ("github", "jira", ...). */
  readonly providerId: string;
  /**
   * Validates credentials and tests connectivity. Called once at registration
   * (or lazily on first use) and on credential rotation.
   */
  initialize(config: MutableKanbanProviderConfig): Promise<void>;
  /** Lists the boards this provider exposes for the given context. */
  listBoards(context: KanbanBoardListContext): Promise<KanbanBoardRef[]>;
  /** Fetches the complete structure of one board, with its fields and values. */
  getBoard(boardId: string): Promise<KanbanBoardSnapshot>;
  /** Moves a card into a different column. */
  moveCard(boardId: string, cardId: string, targetColumnId: string): Promise<void>;
  /**
   * Writes one field on one card. Absent when the provider cannot write fields
   * at all; a provider that can write some fields and not others reports that
   * per field on the board snapshot and throws here for the rest.
   */
  updateCardField?(write: KanbanCardFieldWrite): Promise<KanbanCardUpdateResult>;
  /**
   * Removes a card from its board. Board-scoped: this detaches a linked work
   * item from the board, and only deletes an item outright when that item exists
   * nowhere else (a GitHub draft issue).
   */
  deleteCard?(boardId: string, cardId: string): Promise<void>;
  /**
   * An opaque marker that moves when anything on the board changes, for the
   * freshness poller. Null when the provider cannot report one cheaply, which
   * the poller reads as "compare the board itself instead".
   */
  readBoardRevision?(boardId: string): Promise<string | null>;
  /** Creates a new card in the given (or the provider's default) column. */
  createCard(
    boardId: string,
    columnId: string | null,
    taskData: { title: string; body?: string },
  ): Promise<KanbanCard>;
  /** Pulls an existing external work object (issue/PR) into the board. */
  linkExternalTask(
    boardId: string,
    external: { owner?: string; repo?: string; externalId: string },
    columnId: string | null,
  ): Promise<KanbanCard>;
  /** Releases any provider-owned resources (http caches, timers). */
  dispose?(): void;
}

/**
 * The provider's slice of the host's credentials. Kanban has no credential
 * store of its own: it reuses whatever already authenticates the host to the
 * same service, so a user who can already open PRs can already see the board.
 *
 *   GitHub -> the `gh` CLI owns the credential (`gh auth token`), the same way
 *             the git-hosting GitHub service authenticates. There is no token
 *             field in settings to author or forget.
 *   Jira   -> the shared Atlassian account credential (email + API token, HTTP
 *             Basic) plus the site URL, the same pair Bitbucket git hosting
 *             uses.
 *
 * Secret values may arrive masked to the wire sentinel when the daemon is
 * serving other daemons over the relay; a direct (trusted) host session passes
 * the real values. Providers treat an empty or sentinel credential as "not
 * configured".
 */
export interface MutableKanbanProviderConfig {
  /** GitHub token from the selected project connection or ambient gh login. */
  githubToken?: string | null;
  githubAccount?: string;
  githubCredentialMethod?: "cli" | "token";
  /** Atlassian account email, shared with Bitbucket git hosting. */
  atlassianEmail?: string | null;
  /** Atlassian API token, shared with Bitbucket git hosting. */
  atlassianApiToken?: string | null;
  /** Jira Cloud site origin, e.g. https://acme.atlassian.net. */
  jiraSiteUrl?: string | null;
}

export interface KanbanBoardListContext {
  /** Repository scoping hints for provider discovery. */
  owner?: string;
  repo?: string;
  /** An explicit project target. Providers must return this board only. */
  targetBoardId?: string;
  /** GitHub owner parsed from the configured Projects URL, when available. */
  targetBoardOwner?: string;
}
