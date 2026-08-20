import path from "node:path";
import type { Logger } from "pino";
import { LspConnection, type LspPublishedDiagnostics } from "./connection.js";
import {
  indexRowsByExtension,
  LSP_SERVER_ROWS,
  resolveServerCommand,
  type LspResolveContext,
  type LspServerRow,
} from "./registry.js";
import { documentKey } from "./uri.js";

/**
 * The set of live language servers, keyed by (workspace root × server). Owns the
 * policy the charter's risk list demands before any language ships: lazy spawn,
 * idle reaping, a hard cap on running processes, and capped-backoff restart after
 * a crash. Three workspaces × three languages is nine processes and several
 * gigabytes on the same machine as the agents - none of this is a follow-up.
 *
 * There are deliberately no timers in here. `reapIdle` is called by the daemon on
 * an interval and every decision reads an injected clock, which is what makes the
 * lifecycle testable without waiting on wall time.
 */

export interface LspPoolLimits {
  /** Hard LRU cap on simultaneously running servers, across all workspaces. */
  maxRunningServers: number;
  idleMs: number;
  /** Shorter idle allowance for workspaces the user is not currently looking at. */
  backgroundIdleMs: number;
  crashBackoffMs: number;
  maxCrashBackoffMs: number;
  initializeTimeoutMs: number;
  requestTimeoutMs: number;
}

export interface LspServerPoolOptions {
  logger: Logger;
  limits: LspPoolLimits;
  rows?: readonly LspServerRow[];
  now?: () => number;
  /** Called whenever the set of workspaces with server work in flight may have changed. */
  onActivityChange?: () => void;
  /** Called for every diagnostics push, tagged with which server in which workspace sent it. */
  onDiagnostics?: (event: LspDiagnosticsEvent) => void;
  /**
   * Called once per server process that has ended, for any reason - crash, idle reap,
   * deliberate stop. Whatever that server asserted about a document is no longer backed by
   * a running process and has to be retracted.
   */
  onServerGone?: (event: { rootPath: string; serverId: string }) => void;
}

export interface LspDiagnosticsEvent {
  rootPath: string;
  serverId: string;
  published: LspPublishedDiagnostics;
}

/** Decides whether a row may run at all. The host's settings supply this. */
export type LspRowFilter = (row: LspServerRow) => boolean;

export interface BoundServer {
  serverId: string;
  connection: LspConnection;
}

export interface RunningServer {
  rootPath: string;
  serverId: string;
  startedAt: number;
  uptimeMs: number;
  lastUsedAt: number;
}

export class LspServerNotFoundError extends Error {
  readonly serverId: string;
  readonly rootPath: string;

  constructor(serverId: string, rootPath: string) {
    super(`No ${serverId} language server is available for ${rootPath}`);
    this.name = "LspServerNotFoundError";
    this.serverId = serverId;
    this.rootPath = rootPath;
  }
}

export class LspServerUnavailableError extends Error {
  readonly serverId: string;
  readonly rootPath: string;
  readonly retryInMs: number;

  constructor(serverId: string, rootPath: string, retryInMs: number) {
    super(`Language server ${serverId} crashed; retrying in ${retryInMs}ms`);
    this.name = "LspServerUnavailableError";
    this.serverId = serverId;
    this.rootPath = rootPath;
    this.retryInMs = retryInMs;
  }
}

interface StartingEntry {
  status: "starting";
  rootPath: string;
  row: LspServerRow;
  pending: Promise<LspConnection>;
}

interface RunningEntry {
  status: "running";
  rootPath: string;
  row: LspServerRow;
  connection: LspConnection;
  startedAt: number;
  lastUsedAt: number;
}

interface BackoffEntry {
  status: "backoff";
  rootPath: string;
  row: LspServerRow;
  nextRetryAt: number;
}

type PoolEntry = StartingEntry | RunningEntry | BackoffEntry;

export class LspServerPool {
  private readonly logger: Logger;
  private limits: LspPoolLimits;
  private rowFilter: LspRowFilter = () => true;
  private resolveContext: () => LspResolveContext = () => ({});
  private readonly rowsById: Map<string, LspServerRow>;
  private readonly rowsByExtension: Map<string, LspServerRow[]>;
  private readonly now: () => number;
  private readonly entries = new Map<string, PoolEntry>();
  /** Consecutive crashes per key; survives restart so the backoff can grow. */
  private readonly failures = new Map<string, number>();
  /** Keys we are deliberately stopping, so their exit is not read as a crash. */
  private readonly stopping = new Set<string>();
  private activeWorkspaceKey: string | null = null;
  private readonly reportActivity: () => void;
  private readonly reportDiagnostics: (event: LspDiagnosticsEvent) => void;
  private readonly reportServerGone: (event: { rootPath: string; serverId: string }) => void;

  constructor(options: LspServerPoolOptions) {
    const rows = options.rows ?? LSP_SERVER_ROWS;
    this.logger = options.logger.child({ subsystem: "lsp" });
    this.limits = options.limits;
    this.rowsById = new Map(rows.map((row) => [row.id, row]));
    this.rowsByExtension = indexRowsByExtension(rows);
    this.now = options.now ?? Date.now;
    this.reportActivity = options.onActivityChange ?? (() => {});
    this.reportDiagnostics = options.onDiagnostics ?? (() => {});
    this.reportServerGone = options.onServerGone ?? (() => {});
  }

  setActiveWorkspace(rootPath: string | null): void {
    this.activeWorkspaceKey = rootPath === null ? null : documentKey(rootPath);
  }

  /**
   * Applies the host's per-language policy. A filtered-out row is reported as
   * not-found, which is exactly what it is from the caller's point of view: there is
   * no server for that language on this host right now.
   */
  setRowFilter(filter: LspRowFilter): void {
    this.rowFilter = filter;
  }

  /**
   * Host settings a row consults to derive its spawn args. Read at spawn, never cached, so a
   * setting change reaches the next server started - the running ones keep the args they were
   * spawned with, which is why the service stops them when the setting changes.
   */
  setResolveContext(context: () => LspResolveContext): void {
    this.resolveContext = context;
  }

  setLimits(limits: Partial<LspPoolLimits>): void {
    this.limits = { ...this.limits, ...limits };
  }

  rows(): readonly LspServerRow[] {
    return [...this.rowsById.values()];
  }

  async acquire(rootPath: string, serverId: string): Promise<LspConnection> {
    const row = this.rowsById.get(serverId);
    if (row === undefined || !this.rowFilter(row)) {
      throw new LspServerNotFoundError(serverId, rootPath);
    }

    const key = this.keyFor(rootPath, serverId);
    const existing = this.entries.get(key);

    if (existing?.status === "running") {
      existing.lastUsedAt = this.now();
      return existing.connection;
    }
    if (existing?.status === "starting") {
      return existing.pending;
    }
    if (existing?.status === "backoff") {
      const remaining = existing.nextRetryAt - this.now();
      if (remaining > 0) {
        throw new LspServerUnavailableError(serverId, rootPath, remaining);
      }
      this.entries.delete(key);
    }

    // Nothing may be awaited between the lookup above and this write, or two
    // concurrent callers both miss and spawn a second server for the same key.
    const pending = this.start(key, rootPath, row);
    this.entries.set(key, { status: "starting", rootPath, row, pending });
    this.reportActivity();
    return pending;
  }

  /**
   * Every server that claims this document's extension, which is more than one for
   * an Angular `.ts` file. A server this machine cannot supply is skipped rather
   * than fatal: one server answering is success, not a race.
   */
  async serversForDocument(rootPath: string, filePath: string): Promise<BoundServer[]> {
    const rows = this.rowsByExtension.get(path.extname(filePath).toLowerCase()) ?? [];

    const settled = await Promise.all(
      rows.map(async (row): Promise<BoundServer | null> => {
        try {
          return { serverId: row.id, connection: await this.acquire(rootPath, row.id) };
        } catch (error) {
          this.logger.debug(
            { err: error, lspServer: row.id, rootPath },
            "language server unavailable for document",
          );
          return null;
        }
      }),
    );

    return settled.filter((entry): entry is BoundServer => entry !== null);
  }

  /**
   * The running connection for this key, or null - never spawns. Document sync uses
   * it to notify servers that already hold a document without a `didChange` being
   * able to start a server on its own.
   */
  peek(rootPath: string, serverId: string): LspConnection | null {
    const entry = this.entries.get(this.keyFor(rootPath, serverId));
    if (entry?.status !== "running") {
      return null;
    }
    entry.lastUsedAt = this.now();
    return entry.connection;
  }

  /**
   * Workspace roots with language-server work in flight - a server still starting up,
   * or one reporting work-done progress. This is what a "still working on it" indicator
   * needs, and nothing more.
   */
  busyRoots(): string[] {
    const roots = new Set<string>();
    for (const entry of this.entries.values()) {
      if (entry.status === "starting") {
        roots.add(entry.rootPath);
      } else if (entry.status === "running" && entry.connection.isIndexing) {
        roots.add(entry.rootPath);
      }
    }
    return [...roots];
  }

  running(): RunningServer[] {
    const now = this.now();
    const rows: RunningServer[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status === "running") {
        rows.push({
          rootPath: entry.rootPath,
          serverId: entry.row.id,
          startedAt: entry.startedAt,
          uptimeMs: now - entry.startedAt,
          lastUsedAt: entry.lastUsedAt,
        });
      }
    }
    return rows;
  }

  async reapIdle(): Promise<void> {
    const now = this.now();
    const expired: string[] = [];

    for (const [key, entry] of this.entries) {
      if (entry.status !== "running") {
        continue;
      }
      const isBackground =
        this.activeWorkspaceKey !== null && documentKey(entry.rootPath) !== this.activeWorkspaceKey;
      const allowance = isBackground ? this.limits.backgroundIdleMs : this.limits.idleMs;
      if (now - entry.lastUsedAt > allowance) {
        expired.push(key);
      }
    }

    await Promise.all(expired.map((key) => this.stopEntry(key)));
  }

  async stopServer(rootPath: string, serverId: string): Promise<void> {
    await this.stopEntry(this.keyFor(rootPath, serverId));
  }

  async stopWorkspace(rootPath: string): Promise<void> {
    const workspaceKey = documentKey(rootPath);
    const keys = [...this.entries]
      .filter(([, entry]) => documentKey(entry.rootPath) === workspaceKey)
      .map(([key]) => key);

    await Promise.all(keys.map((key) => this.stopEntry(key)));
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((key) => this.stopEntry(key)));
  }

  private async start(key: string, rootPath: string, row: LspServerRow): Promise<LspConnection> {
    await this.enforceRunningCap(key);

    const resolved = await resolveServerCommand(row, rootPath, this.resolveContext());
    if (resolved === null) {
      // Absence is a fact about this machine, not a failure to back off from.
      this.entries.delete(key);
      throw new LspServerNotFoundError(row.id, rootPath);
    }

    try {
      const connection = await LspConnection.start({
        spec: {
          id: row.id,
          command: resolved.command,
          args: resolved.args,
          rootPath,
          initializationOptions: row.initializationOptions,
          ...(row.runtime === undefined ? {} : { runtime: row.runtime }),
        },
        logger: this.logger,
        initializeTimeoutMs: this.limits.initializeTimeoutMs,
        requestTimeoutMs: this.limits.requestTimeoutMs,
        onExit: () => {
          this.handleExit(key);
          this.reportServerGone({ rootPath, serverId: row.id });
          this.reportActivity();
        },
        onActivityChange: () => this.reportActivity(),
        onDiagnostics: (published) =>
          this.reportDiagnostics({ rootPath, serverId: row.id, published }),
      });

      const startedAt = this.now();
      this.entries.set(key, {
        status: "running",
        rootPath,
        row,
        connection,
        startedAt,
        lastUsedAt: startedAt,
      });
      this.logger.info(
        { lspServer: row.id, rootPath, rung: resolved.rung },
        "language server started",
      );
      this.reportActivity();
      return connection;
    } catch (error) {
      this.recordCrash(key, rootPath, row);
      throw error;
    }
  }

  private handleExit(key: string): void {
    const entry = this.entries.get(key);
    if (entry === undefined || this.stopping.has(key)) {
      return;
    }
    if (entry.status !== "running") {
      // Died mid-handshake; `start` records the failure so the backoff is not
      // counted twice.
      return;
    }
    this.recordCrash(key, entry.rootPath, entry.row);
  }

  private recordCrash(key: string, rootPath: string, row: LspServerRow): void {
    const failures = (this.failures.get(key) ?? 0) + 1;
    this.failures.set(key, failures);

    const backoff = Math.min(
      this.limits.crashBackoffMs * 2 ** (failures - 1),
      this.limits.maxCrashBackoffMs,
    );
    this.entries.set(key, {
      status: "backoff",
      rootPath,
      row,
      nextRetryAt: this.now() + backoff,
    });
    this.logger.warn(
      { lspServer: row.id, rootPath, failures, backoffMs: backoff },
      "language server crashed; backing off",
    );
  }

  /**
   * `pendingKey` is the server currently being started. It is excluded from both
   * the count and the victim search: `acquire` registers it before this runs, so
   * counting it would make the pool evict one server too many - and it could pick
   * itself as the victim.
   */
  private async enforceRunningCap(pendingKey: string): Promise<void> {
    while (this.occupancyExcluding(pendingKey) >= this.limits.maxRunningServers) {
      const victim = this.leastRecentlyUsedKey(pendingKey);
      if (victim === null) {
        return;
      }
      this.logger.info({ key: victim }, "evicting least recently used language server");
      await this.stopEntry(victim);
    }
  }

  private occupancyExcluding(pendingKey: string): number {
    let count = 0;
    for (const [key, entry] of this.entries) {
      if (key === pendingKey) {
        continue;
      }
      if (entry.status === "running" || entry.status === "starting") {
        count += 1;
      }
    }
    return count;
  }

  private leastRecentlyUsedKey(pendingKey: string): string | null {
    let oldestKey: string | null = null;
    let oldestUsedAt = Number.POSITIVE_INFINITY;

    for (const [key, entry] of this.entries) {
      if (key === pendingKey || entry.status !== "running") {
        continue;
      }
      if (entry.lastUsedAt < oldestUsedAt) {
        oldestUsedAt = entry.lastUsedAt;
        oldestKey = key;
      }
    }
    return oldestKey;
  }

  private async stopEntry(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return;
    }

    if (entry.status === "starting") {
      await entry.pending.catch(() => {});
    }

    const current = this.entries.get(key);
    if (current?.status === "running") {
      this.stopping.add(key);
      try {
        await current.connection.stop();
      } finally {
        this.stopping.delete(key);
      }
    }

    this.entries.delete(key);
    this.failures.delete(key);
  }

  private keyFor(rootPath: string, serverId: string): string {
    return `${documentKey(rootPath)}\0${serverId}`;
  }
}
