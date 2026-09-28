import {
  KANBAN_NOT_CONFIGURED,
  type KanbanBoardRef,
  type KanbanCard,
  type KanbanRemediation,
} from "@otto-code/protocol/kanban";
import type {
  KanbanBoardGetRequest,
  KanbanBoardsListRequest,
  KanbanBoardWatchRequest,
  KanbanCardCreateRequest,
  KanbanCardDeleteRequest,
  KanbanCardMoveRequest,
  KanbanCardUpdateRequest,
  KanbanTaskLinkRequest,
  SessionOutboundMessage,
} from "@otto-code/protocol/messages";
import { createKanbanRegistry, type KanbanRegistry } from "./kanban-registry.js";
import { remediationOf } from "./kanban-remediation.js";
import type {
  KanbanBoardListContext,
  KanbanBoardSnapshot,
  KanbanCardUpdateResult,
} from "./types.js";
import { KanbanBoardWatcher } from "./kanban-board-watcher.js";
import type { MutableDaemonConfig } from "@otto-code/protocol/messages";
import type { ForgeConnectionStore } from "../../services/git-hosting/connection-store.js";

// The "this project has no board yet" message lives with the wire model in
// @otto-code/protocol/kanban so the app can compare against it without a
// server dependency. Re-exported here for existing callers.
export { KANBAN_NOT_CONFIGURED };

/**
 * Session-facing Kanban dispatcher. Owns the provider registry, translates
 * wire requests to SPI calls, and emits correlated responses. Provider
 * failures become a plain `error` string in the response payload - the wire
 * never sees a provider-specific error type.
 */
/**
 * A project's configured board, resolved by the daemon. The app never picks a
 * provider: it names a project, and this is what that project points at.
 */
export interface KanbanProjectTarget {
  projectId?: string;
  adapter: "github" | "jira";
  /** Explicit board, or null for github meaning "derive from the git remote". */
  boardId: string | null;
  /** GitHub owner parsed from an explicit Projects URL, when available. */
  boardOwner?: string;
  /** Repo scoping for the github adapter, from the project's git remote. */
  owner?: string;
  repo?: string;
}

export interface KanbanSessionHost {
  emit(message: SessionOutboundMessage): void;
  readConfig: () => MutableDaemonConfig;
  /**
   * Resolves a project to its Kanban target, or null when the project has none
   * configured. Null is a normal state - the screen renders "no board
   * configured" and links into project settings - not an error.
   */
  resolveProjectTarget: (input: {
    projectId?: string;
    projectKey?: string;
  }) => Promise<KanbanProjectTarget | null>;
  log: {
    info: (message: string) => void;
    error: (message: string, error?: unknown) => void;
  };
  connections?: ForgeConnectionStore;
  /**
   * Registry factory. Injectable for the same reason the registry's own gh
   * token resolver is: a test must never shell out to a real `gh` binary or
   * reach GitHub. Production leaves it unset.
   */
  createRegistry?: (options: {
    readConfig: () => MutableDaemonConfig;
    projectId?: string;
    connections?: ForgeConnectionStore;
  }) => KanbanRegistry;
}

export class KanbanSession {
  private readonly registries = new Map<string, KanbanRegistry>();
  private readonly retiredRegistries: KanbanRegistry[] = [];
  private readonly unsubscribeConnections: (() => void) | undefined;
  private readonly host: KanbanSessionHost;
  private initializedProviders = new Set<string>();
  private readonly watcher: KanbanBoardWatcher;

  constructor(host: KanbanSessionHost) {
    this.host = host;
    this.unsubscribeConnections = host.connections?.subscribe(() => {
      // Let in-flight operations finish with their original provider instance.
      this.retiredRegistries.push(...this.registries.values());
      this.registries.clear();
      this.initializedProviders.clear();
    });
    this.watcher = new KanbanBoardWatcher({
      host: {
        onChanged: ({ providerId, boardId, revision }) => {
          this.host.emit({
            type: "kanban.board.changed",
            payload: { providerId, boardId, ...(revision ? { revision } : {}) },
          });
        },
        log: this.host.log,
      },
    });
  }

  private registryFor(projectId?: string): KanbanRegistry {
    const key = projectId ?? "";
    let registry = this.registries.get(key);
    if (!registry) {
      const create = this.host.createRegistry ?? createKanbanRegistry;
      registry = create({
        readConfig: this.host.readConfig,
        ...(projectId ? { projectId } : {}),
        ...(this.host.connections ? { connections: this.host.connections } : {}),
      });
      this.registries.set(key, registry);
    }
    return registry;
  }

  async handleBoardsListRequest(msg: KanbanBoardsListRequest): Promise<void> {
    // The wire still carries providerId so an older client keeps working, but a
    // project-scoped request is authoritative: the project's configured target
    // decides the provider, so the app's picker never has to know one exists.
    let providerId = msg.providerId;
    let projectId = msg.projectId;
    let context: KanbanBoardListContext = {};
    const emit = (
      boards: KanbanBoardRef[],
      error: string | null,
      remediation: KanbanRemediation | null = null,
    ) => {
      this.host.emit({
        type: "kanban.boards.list.response",
        payload: { providerId, boards, error, remediation, requestId: msg.requestId },
      });
    };

    if (msg.projectId || msg.projectKey) {
      let target: KanbanProjectTarget | null;
      try {
        target = await this.host.resolveProjectTarget({
          ...(msg.projectId ? { projectId: msg.projectId } : {}),
          ...(msg.projectKey ? { projectKey: msg.projectKey } : {}),
        });
      } catch (error) {
        this.host.log.error("kanban.boards.list project lookup failed", error);
        emit([], describeError(error));
        return;
      }
      if (!target) {
        emit([], KANBAN_NOT_CONFIGURED);
        return;
      }
      providerId = target.adapter;
      projectId = target.projectId ?? msg.projectId;
      context = {
        ...(target.owner ? { owner: target.owner } : {}),
        ...(target.repo ? { repo: target.repo } : {}),
        ...(target.boardId ? { targetBoardId: target.boardId } : {}),
        ...(target.boardOwner || target.owner
          ? { targetBoardOwner: target.boardOwner ?? target.owner }
          : {}),
      };
    }

    const provider = this.registryFor(projectId).getProvider(providerId);
    if (!provider) {
      emit([], `Unknown kanban provider: ${providerId}`);
      return;
    }
    try {
      await this.ensureInitialized(providerId, projectId);
      emit(await provider.listBoards(context), null);
    } catch (error) {
      this.host.log.error("kanban.boards.list failed", error);
      emit([], ...this.failure(providerId, error, projectId));
    }
  }

  async handleBoardGetRequest(msg: KanbanBoardGetRequest): Promise<void> {
    const emit = (
      snapshot: KanbanBoardSnapshot | null,
      error: string | null,
      remediation: KanbanRemediation | null = null,
    ) => {
      this.host.emit({
        type: "kanban.board.get.response",
        payload: {
          providerId: msg.providerId,
          board: snapshot?.board ?? null,
          // The field sidecar is omitted entirely when a provider exposes no
          // fields, so a client cannot tell "no fields" apart from "an older
          // daemon" by accident - the capability flag is the one signal.
          ...(snapshot && snapshot.fields.length > 0
            ? { fields: snapshot.fields, cardFields: snapshot.cardFields }
            : {}),
          ...(snapshot ? { canDeleteCards: Boolean(provider?.deleteCard) } : {}),
          error,
          remediation,
          requestId: msg.requestId,
        },
      });
    };
    const provider = this.registryFor(msg.projectId).getProvider(msg.providerId);
    if (!provider) {
      emit(null, `Unknown kanban provider: ${msg.providerId}`);
      return;
    }
    try {
      await this.ensureInitialized(msg.providerId, msg.projectId);
      emit(await provider.getBoard(msg.boardId), null);
    } catch (error) {
      this.host.log.error("kanban.board.get failed", error);
      emit(null, ...this.failure(msg.providerId, error, msg.projectId));
    }
  }

  async handleCardUpdateRequest(msg: KanbanCardUpdateRequest): Promise<void> {
    const emit = (
      result: KanbanCardUpdateResult | null,
      error: string | null,
      remediation: KanbanRemediation | null = null,
    ) => {
      this.host.emit({
        type: "kanban.card.update.response",
        payload: {
          providerId: msg.providerId,
          boardId: msg.boardId,
          cardId: msg.cardId,
          fieldId: msg.fieldId,
          card: result?.card ?? null,
          ...(result ? { cardFields: result.fieldValues } : {}),
          error,
          remediation,
          requestId: msg.requestId,
        },
      });
    };
    const provider = this.registryFor(msg.projectId).getProvider(msg.providerId);
    if (!provider) {
      emit(null, `Unknown kanban provider: ${msg.providerId}`);
      return;
    }
    if (!provider.updateCardField) {
      emit(null, `${msg.providerId} boards cannot edit card fields from Otto.`);
      return;
    }
    try {
      await this.ensureInitialized(msg.providerId, msg.projectId);
      emit(
        await provider.updateCardField({
          boardId: msg.boardId,
          cardId: msg.cardId,
          fieldId: msg.fieldId,
          value: msg.value,
        }),
        null,
      );
    } catch (error) {
      this.host.log.error("kanban.card.update failed", error);
      emit(null, ...this.failure(msg.providerId, error, msg.projectId));
    }
  }

  async handleCardDeleteRequest(msg: KanbanCardDeleteRequest): Promise<void> {
    const emit = (error: string | null, remediation: KanbanRemediation | null = null) => {
      this.host.emit({
        type: "kanban.card.delete.response",
        payload: {
          providerId: msg.providerId,
          boardId: msg.boardId,
          cardId: msg.cardId,
          error,
          remediation,
          requestId: msg.requestId,
        },
      });
    };
    const provider = this.registryFor(msg.projectId).getProvider(msg.providerId);
    if (!provider) {
      emit(`Unknown kanban provider: ${msg.providerId}`);
      return;
    }
    if (!provider.deleteCard) {
      emit(`${msg.providerId} boards cannot delete cards from Otto.`);
      return;
    }
    try {
      await this.ensureInitialized(msg.providerId, msg.projectId);
      await provider.deleteCard(msg.boardId, msg.cardId);
      emit(null);
    } catch (error) {
      this.host.log.error("kanban.card.delete failed", error);
      emit(...this.failure(msg.providerId, error, msg.projectId));
    }
  }

  async handleBoardWatchRequest(msg: KanbanBoardWatchRequest): Promise<void> {
    const emit = (watching: boolean, error: string | null, pollIntervalMs?: number) => {
      this.host.emit({
        type: "kanban.board.watch.response",
        payload: {
          providerId: msg.providerId,
          boardId: msg.boardId,
          watching,
          ...(pollIntervalMs === undefined ? {} : { pollIntervalMs }),
          error,
          requestId: msg.requestId,
        },
      });
    };
    if (!msg.watch) {
      this.watcher.unwatch(msg.providerId, msg.boardId, msg.projectId);
      emit(false, null);
      return;
    }
    const provider = this.registryFor(msg.projectId).getProvider(msg.providerId);
    if (!provider) {
      emit(false, `Unknown kanban provider: ${msg.providerId}`);
      return;
    }
    if (!provider.readBoardRevision) {
      // Not an error: the board simply will not refresh itself, and the client
      // keeps its manual refresh. Saying so beats a watch that silently never
      // fires.
      emit(false, `${msg.providerId} boards cannot report changes to Otto.`);
      return;
    }
    try {
      await this.ensureInitialized(msg.providerId, msg.projectId);
      const interval = this.watcher.watch(
        msg.providerId,
        msg.boardId,
        () => this.readRevision(msg.providerId, msg.boardId, msg.projectId),
        msg.projectId,
      );
      emit(true, null, interval);
    } catch (error) {
      this.host.log.error("kanban.board.watch failed", error);
      emit(false, describeError(error));
    }
  }

  private async readRevision(
    providerId: string,
    boardId: string,
    projectId?: string,
  ): Promise<string | null> {
    const provider = this.registryFor(projectId).getProvider(providerId);
    if (!provider?.readBoardRevision) {
      return null;
    }
    await this.ensureInitialized(providerId, projectId);
    return provider.readBoardRevision(boardId);
  }

  async handleCardMoveRequest(msg: KanbanCardMoveRequest): Promise<void> {
    const emit = (error: string | null, remediation: KanbanRemediation | null = null) => {
      this.host.emit({
        type: "kanban.card.move.response",
        payload: {
          providerId: msg.providerId,
          boardId: msg.boardId,
          cardId: msg.cardId,
          targetColumnId: msg.targetColumnId,
          error,
          remediation,
          requestId: msg.requestId,
        },
      });
    };
    const provider = this.registryFor(msg.projectId).getProvider(msg.providerId);
    if (!provider) {
      emit(`Unknown kanban provider: ${msg.providerId}`);
      return;
    }
    try {
      await this.ensureInitialized(msg.providerId, msg.projectId);
      await provider.moveCard(msg.boardId, msg.cardId, msg.targetColumnId);
      emit(null);
    } catch (error) {
      this.host.log.error("kanban.card.move failed", error);
      emit(...this.failure(msg.providerId, error, msg.projectId));
    }
  }

  async handleCardCreateRequest(msg: KanbanCardCreateRequest): Promise<void> {
    const emit = (
      columnId: string,
      card: KanbanCard | null,
      error: string | null,
      remediation: KanbanRemediation | null = null,
    ) => {
      this.host.emit({
        type: "kanban.card.create.response",
        payload: {
          providerId: msg.providerId,
          boardId: msg.boardId,
          columnId,
          card,
          error,
          remediation,
          requestId: msg.requestId,
        },
      });
    };
    const provider = this.registryFor(msg.projectId).getProvider(msg.providerId);
    if (!provider) {
      emit(msg.columnId ?? "default", null, `Unknown kanban provider: ${msg.providerId}`);
      return;
    }
    try {
      await this.ensureInitialized(msg.providerId, msg.projectId);
      const card = await provider.createCard(msg.boardId, msg.columnId ?? null, {
        title: msg.title,
        ...(msg.body ? { body: msg.body } : {}),
      });
      emit(msg.columnId ?? "default", card, null);
    } catch (error) {
      this.host.log.error("kanban.card.create failed", error);
      emit(msg.columnId ?? "default", null, ...this.failure(msg.providerId, error, msg.projectId));
    }
  }

  async handleTaskLinkRequest(msg: KanbanTaskLinkRequest): Promise<void> {
    const emit = (
      columnId: string,
      card: KanbanCard | null,
      error: string | null,
      remediation: KanbanRemediation | null = null,
    ) => {
      this.host.emit({
        type: "kanban.task.link.response",
        payload: {
          providerId: msg.providerId,
          boardId: msg.boardId,
          columnId,
          card,
          error,
          remediation,
          requestId: msg.requestId,
        },
      });
    };
    const provider = this.registryFor(msg.projectId).getProvider(msg.providerId);
    if (!provider) {
      emit(msg.columnId ?? "default", null, `Unknown kanban provider: ${msg.providerId}`);
      return;
    }
    try {
      await this.ensureInitialized(msg.providerId, msg.projectId);
      const card = await provider.linkExternalTask(
        msg.boardId,
        { externalId: msg.externalId, ...(await this.resolveLinkRepo(msg)) },
        msg.columnId ?? null,
      );
      emit(msg.columnId ?? "default", card, null);
    } catch (error) {
      this.host.log.error("kanban.task.link failed", error);
      emit(msg.columnId ?? "default", null, ...this.failure(msg.providerId, error, msg.projectId));
    }
  }

  /**
   * The repository a bare issue or pull-request number should resolve against.
   *
   * Derived from the project, never taken from the client: a number alone is
   * ambiguous across repositories, and letting the caller name one would let a
   * link point at an issue from somewhere else entirely. A project with no
   * readable git remote yields nothing, and the provider then asks for a URL
   * rather than guessing.
   */
  private async resolveLinkRepo(msg: KanbanTaskLinkRequest): Promise<{
    owner?: string;
    repo?: string;
  }> {
    if (!msg.projectId && !msg.projectKey) {
      return {};
    }
    try {
      const target = await this.host.resolveProjectTarget({
        ...(msg.projectId ? { projectId: msg.projectId } : {}),
        ...(msg.projectKey ? { projectKey: msg.projectKey } : {}),
      });
      return target?.owner && target.repo ? { owner: target.owner, repo: target.repo } : {};
    } catch (error) {
      // The link itself may still succeed with a node id, so a project lookup
      // failure is context we lack rather than a reason to refuse.
      this.host.log.error("kanban.task.link project lookup failed", error);
      return {};
    }
  }

  /**
   * Turns a provider failure into the wire's (error, remediation) pair.
   *
   * A remediable failure is always credential-shaped, and the user fixes it
   * outside Otto: granting the scopes to the gh CLI mints a *new* token, so the
   * initialized provider is left holding a credential that can never succeed.
   * Dropping the initialization here means the next request re-reads it, and
   * the user's retry after running the command actually works.
   */
  private failure(
    providerId: string,
    error: unknown,
    projectId?: string,
  ): [string, KanbanRemediation | null] {
    const remediation = remediationOf(error);
    if (remediation) {
      this.initializedProviders.delete(`${projectId ?? ""}:${providerId}`);
    }
    return [describeError(error), remediation];
  }

  private async ensureInitialized(providerId: string, projectId?: string): Promise<void> {
    const key = `${projectId ?? ""}:${providerId}`;
    if (this.initializedProviders.has(key)) {
      return;
    }
    const registry = this.registryFor(projectId);
    await registry.initialize(providerId);
    if (this.registryFor(projectId) === registry) this.initializedProviders.add(key);
  }

  dispose(): void {
    this.unsubscribeConnections?.();
    this.watcher.dispose();
    for (const registry of this.registries.values()) registry.dispose();
    for (const registry of this.retiredRegistries) registry.dispose();
    this.registries.clear();
    this.initializedProviders.clear();
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
