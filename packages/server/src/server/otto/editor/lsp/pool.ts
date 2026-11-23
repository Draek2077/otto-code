import type { Logger } from "pino";
import { EditorError } from "../errors.js";
import { LanguageConnection } from "./connection.js";
import { languageFor, resolveServer, SERVER_ROWS, type ServerRow } from "./registry.js";
import type { PublishedDiagnostics } from "./schema.js";
import { pathKey } from "./uri.js";

export interface PoolPolicy {
  enabled: boolean;
  languages: Readonly<Record<string, boolean>>;
  maxServers: number;
  idleMs: number;
  backgroundIdleMs: number;
  allCsharpProjects: boolean;
}
export const DEFAULT_POLICY: PoolPolicy = {
  enabled: true,
  languages: {},
  maxServers: 4,
  idleMs: 10 * 60000,
  backgroundIdleMs: 2 * 60000,
  allCsharpProjects: false,
};
interface Entry {
  root: string;
  row: ServerRow;
  connection: LanguageConnection;
  ready: Promise<void>;
  uses: number;
}
interface Crash {
  root: string;
  failures: number;
  retryAt: number;
}
export interface BoundConnection {
  row: ServerRow;
  connection: LanguageConnection;
  languageId: string;
}
export interface PoolOptions {
  logger: Logger;
  rows?: readonly ServerRow[];
  policy(): PoolPolicy;
  onDiagnostics(root: string, serverId: string, value: PublishedDiagnostics, text: string): void;
  onServerGone(root: string, serverId: string): void;
}

/** One pool per daemon, never one per editor or connected client. */
export class LanguageServerPool {
  private readonly entries = new Map<string, Entry>();
  private readonly crashes = new Map<string, Crash>();
  private readonly queues = new Map<string, Promise<void>>();
  private admission: Promise<void> = Promise.resolve();
  private activeRoot: string | null = null;
  private closed = false;
  private reap: ReturnType<typeof setInterval> | null = null;
  readonly rows: readonly ServerRow[];
  constructor(private readonly options: PoolOptions) {
    this.rows = options.rows ?? SERVER_ROWS;
  }

  /** Timer starts with first actual editor demand, not daemon construction. */
  private observe(root: string) {
    this.activeRoot = pathKey(root);
    if (!this.reap) {
      this.reap = setInterval(() => {
        void this.reapIdle().catch((error) =>
          this.options.logger.warn({ err: error }, "Language server idle cleanup failed"),
        );
      }, 30000);
      this.reap.unref();
    }
  }

  async withDocument<T>(
    root: string,
    file: string,
    work: (servers: readonly BoundConnection[]) => Promise<T>,
    isCurrent: () => boolean = () => true,
  ): Promise<T> {
    if (this.closed) throw new EditorError("closed", "Code intelligence is shutting down.");
    const key = pathKey(root);
    const previous = this.queues.get(key) ?? Promise.resolve();
    const result = previous.then(() => this.useDocument(root, file, work, isCurrent));
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(key, settled);
    void settled.then(() => {
      if (this.queues.get(key) === settled) this.queues.delete(key);
      return undefined;
    });
    return result;
  }
  private async useDocument<T>(
    root: string,
    file: string,
    work: (servers: readonly BoundConnection[]) => Promise<T>,
    isCurrent: () => boolean,
  ): Promise<T> {
    if (this.closed || !isCurrent()) throw new EditorError("closed", "Editor demand was released.");
    this.observe(root);
    const policy = this.options.policy();
    if (!policy.enabled)
      throw new EditorError("unavailable", "Code intelligence is turned off on this host.");
    const rows = this.rows.filter((row) => languageFor(row, file) && this.enabled(row));
    const servers: BoundConnection[] = [];
    const held: Entry[] = [];
    try {
      // Admission is serial; semantic requests from different workspaces are not.
      for (const row of rows) {
        try {
          const entry = await this.acquire(root, row, isCurrent);
          if (!entry) continue;
          held.push(entry);
          const languageId = languageFor(row, file);
          if (languageId) servers.push({ row, connection: entry.connection, languageId });
        } catch (error) {
          this.options.logger.warn(
            { err: error, serverId: row.id, root },
            "Language server unavailable",
          );
        }
      }
      if (!isCurrent()) throw new EditorError("closed", "Editor demand was released.");
      return await work(servers);
    } finally {
      for (const entry of held) entry.uses--;
    }
  }
  private enabled(row: ServerRow) {
    return this.options.policy().languages[row.id] ?? row.defaultEnabled;
  }
  private acquire(root: string, row: ServerRow, isCurrent: () => boolean): Promise<Entry | null> {
    const result = this.admission.then(() => this.admit(root, row, isCurrent));
    this.admission = result.then(
      () => undefined,
      () => undefined,
    );
    return result.then(async (entry) => {
      if (!entry) return null;
      try {
        await entry.ready;
        return entry;
      } catch (error) {
        const key = JSON.stringify([pathKey(root), row.id]);
        if (this.entries.get(key) === entry) await this.remove(key);
        throw error;
      }
    });
  }
  private async admit(
    root: string,
    row: ServerRow,
    isCurrent: () => boolean,
  ): Promise<Entry | null> {
    if (this.closed || !isCurrent() || !this.options.policy().enabled || !this.enabled(row))
      return null;
    const key = JSON.stringify([pathKey(root), row.id]);
    const existing = this.entries.get(key);
    if (existing?.connection.alive) {
      existing.uses++;
      return existing;
    }
    const crash = this.crashes.get(key);
    if (crash && Date.now() < crash.retryAt)
      throw new EditorError(
        "unavailable",
        "Language server is recovering from a failure. Try again shortly.",
      );
    const launch = await resolveServer(row, root, this.options.policy().allCsharpProjects);
    if (!launch || !isCurrent()) return null;
    if (!(await this.makeRoom())) return null;
    if (this.closed || !isCurrent() || !this.options.policy().enabled || !this.enabled(row))
      return null;
    const connection = new LanguageConnection({
      row,
      root,
      launch,
      logger: this.options.logger,
      onDiagnostics: (value, text) => this.options.onDiagnostics(root, row.id, value, text),
      onExit: () => this.gone(key),
    });
    const entry: Entry = { root, row, connection, ready: Promise.resolve(), uses: 1 };
    this.entries.set(key, entry);
    entry.ready = connection.start();
    // Reservation is serialized, not initialization. One hung C# handshake
    // must not delay TypeScript/Python in other workspaces until its timeout.
    return entry;
  }
  private async makeRoom() {
    if (this.entries.size < this.options.policy().maxServers) return true;
    const idle = [...this.entries.entries()].filter(([, entry]) => entry.uses === 0);
    idle.sort((a, b) => a[1].connection.lastUsedAt - b[1].connection.lastUsedAt);
    const oldest = idle[0];
    if (!oldest) return false;
    await this.remove(oldest[0]);
    return true;
  }
  private gone(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    const wasHealthy = Date.now() - entry.connection.startedAt >= 60000;
    const failures = wasHealthy ? 1 : (this.crashes.get(key)?.failures ?? 0) + 1;
    this.crashes.set(key, {
      root: entry.root,
      failures,
      retryAt: Date.now() + Math.min(60000, 2000 * 2 ** Math.min(failures - 1, 5)),
    });
    while (this.crashes.size > 256) {
      const oldest = this.crashes.keys().next().value;
      if (oldest) this.crashes.delete(oldest);
    }
    this.options.onServerGone(entry.root, entry.row.id);
    // A server can close stdout while keeping its process alive.
    void entry.connection
      .close()
      .catch((error) =>
        this.options.logger.warn({ err: error }, "Language server exit cleanup failed"),
      );
  }
  private async remove(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key); // Deliberate teardown is not a crash/backoff event.
    this.options.onServerGone(entry.root, entry.row.id);
    await entry.connection.close();
  }
  running() {
    return [...this.entries.values()].map(({ root, row, connection }) => ({
      root,
      serverId: row.id,
      startedAt: connection.startedAt,
      lastUsedAt: connection.lastUsedAt,
      indexing: connection.indexing,
    }));
  }
  async stop(root: string, serverId: string) {
    await this.remove(JSON.stringify([pathKey(root), serverId]));
  }
  async releaseWorkspace(root: string) {
    for (const [key, entry] of this.entries)
      if (pathKey(entry.root) === pathKey(root)) await this.remove(key);
    for (const [key, crash] of this.crashes)
      if (pathKey(crash.root) === pathKey(root)) this.crashes.delete(key);
  }
  async closeDocument(root: string, file: string) {
    for (const entry of this.entries.values()) {
      if (pathKey(entry.root) === pathKey(root)) await entry.connection.closeDocument(file);
    }
  }
  async applyPolicy() {
    const policy = this.options.policy();
    for (const [key, entry] of this.entries)
      if (!policy.enabled || !this.enabled(entry.row)) await this.remove(key);
    while (this.entries.size > policy.maxServers) if (!(await this.makeRoom())) break;
  }
  async reapIdle(now = Date.now()) {
    const policy = this.options.policy();
    for (const [key, entry] of this.entries) {
      const ttl = pathKey(entry.root) === this.activeRoot ? policy.idleMs : policy.backgroundIdleMs;
      if (entry.uses === 0 && now - entry.connection.lastUsedAt >= ttl) await this.remove(key);
    }
  }
  async close() {
    this.closed = true;
    if (this.reap) clearInterval(this.reap);
    this.reap = null;
    // Stop current children before awaiting admission, including initialize waits.
    for (const key of this.entries.keys()) await this.remove(key);
    await this.admission;
    this.crashes.clear();
  }
}
