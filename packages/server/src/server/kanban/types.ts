import type { KanbanBoard, KanbanBoardRef, KanbanCard } from "@otto-code/protocol/kanban";

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
 * Jira is the next provider: boards map to Jira boards, columns to quick
 * filters, and moveCard to `moveIssue`. The wire and the UI stay untouched.
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
  /** Fetches the complete structure of one board. */
  getBoard(boardId: string): Promise<KanbanBoard>;
  /** Moves a card into a different column. */
  moveCard(boardId: string, cardId: string, targetColumnId: string): Promise<void>;
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
 * The provider's slice of the daemon config, projected from
 * MutableDaemonConfig by the session. Secret values may arrive masked to the
 * wire sentinel when the daemon is serving other daemons over the relay; a
 * direct (trusted) host session passes the real values. Providers treat an
 * empty or sentinel token as "not configured".
 */
export interface MutableKanbanProviderConfig {
  githubToken?: string | null;
  jiraToken?: string | null;
}

export interface KanbanBoardListContext {
  /** Optional scoping hints; providers ignore what they do not understand. */
  owner?: string;
  repo?: string;
}
