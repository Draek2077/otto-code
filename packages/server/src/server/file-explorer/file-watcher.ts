import { watch as fsWatch, type FSWatcher } from "node:fs";
import path from "node:path";
import type pino from "pino";
import { resolveExplorerFileIdentity, type ExplorerFileIdentity } from "./service.js";

// Per-session watcher for files open in editor/viewer tabs. Uses fs.watch on
// the parent directory (survives atomic rename-replace writes and detects
// delete/recreate) with a batch polling fallback - the proven pattern from
// artifact-watcher.ts. Events fire only when the content identity actually
// changed: a bare mtime touch with an identical hash is swallowed.

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_DEBOUNCE_MS = 200;

export interface FileWatchChange {
  cwd: string;
  path: string;
  change: "changed" | "deleted" | "recreated";
  modifiedAt: string | null;
  hash: string | null;
  size: number | null;
}

export interface SessionFileWatcherOptions {
  emitEvent: (event: FileWatchChange) => void;
  logger: pino.Logger;
  pollIntervalMs?: number;
  debounceMs?: number;
}

interface WatchEntry {
  cwd: string;
  relativePath: string;
  resolvedPath: string;
  dirWatcher: FSWatcher | null;
  identity: ExplorerFileIdentity | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  checking: boolean;
  recheck: boolean;
}

function buildWatchKey(input: { cwd: string; path: string }): string {
  return `${input.cwd}\0${input.path}`;
}

export class SessionFileWatcher {
  private readonly emitEvent: (event: FileWatchChange) => void;
  private readonly logger: pino.Logger;
  private readonly pollIntervalMs: number;
  private readonly debounceMs: number;
  private readonly entries = new Map<string, WatchEntry>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SessionFileWatcherOptions) {
    this.emitEvent = options.emitEvent;
    this.logger = options.logger.child({ module: "session-file-watcher" });
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  /** Idempotent per (cwd, path). Throws on containment violations. */
  async subscribe(input: { cwd: string; path: string }): Promise<void> {
    const key = buildWatchKey(input);
    if (this.entries.has(key)) {
      return;
    }
    const resolved = await resolveExplorerFileIdentity({
      root: input.cwd,
      relativePath: input.path,
    });
    const entry: WatchEntry = {
      cwd: input.cwd,
      relativePath: input.path,
      resolvedPath: resolved.resolvedPath,
      dirWatcher: null,
      identity: resolved.identity,
      debounceTimer: null,
      checking: false,
      recheck: false,
    };
    const fileName = path.basename(resolved.resolvedPath);
    try {
      entry.dirWatcher = fsWatch(
        path.dirname(resolved.resolvedPath),
        { persistent: false },
        (_eventType, changedName) => {
          // Some platforms omit the filename; check on every ambiguous event.
          if (!changedName || changedName === fileName) {
            this.scheduleCheck(key);
          }
        },
      );
    } catch (error) {
      this.logger.warn(
        { err: error, path: input.path },
        "fs.watch unavailable for watched file; relying on polling fallback",
      );
    }
    this.entries.set(key, entry);
    this.startPolling();
  }

  unsubscribe(input: { cwd: string; path: string }): void {
    const key = buildWatchKey(input);
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }
    this.cleanupEntry(entry);
    this.entries.delete(key);
    if (this.entries.size === 0) {
      this.stopPolling();
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      this.cleanupEntry(entry);
    }
    this.entries.clear();
    this.stopPolling();
  }

  private cleanupEntry(entry: WatchEntry): void {
    entry.dirWatcher?.close();
    if (entry.debounceTimer !== null) {
      clearTimeout(entry.debounceTimer);
      entry.debounceTimer = null;
    }
  }

  private startPolling(): void {
    if (this.pollTimer) {
      return;
    }
    this.pollTimer = setInterval(() => {
      for (const key of this.entries.keys()) {
        void this.check(key);
      }
    }, this.pollIntervalMs);
    this.pollTimer.unref?.();
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private scheduleCheck(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }
    if (entry.debounceTimer !== null) {
      clearTimeout(entry.debounceTimer);
    }
    entry.debounceTimer = setTimeout(() => {
      entry.debounceTimer = null;
      void this.check(key);
    }, this.debounceMs);
    entry.debounceTimer.unref?.();
  }

  private async check(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }
    if (entry.checking) {
      entry.recheck = true;
      return;
    }
    entry.checking = true;
    try {
      const resolved = await resolveExplorerFileIdentity({
        root: entry.cwd,
        relativePath: entry.relativePath,
        previous: entry.identity,
      });
      const previous = entry.identity;
      const identity = resolved.identity;
      if (!identity) {
        if (previous) {
          entry.identity = null;
          this.emitEvent({
            cwd: entry.cwd,
            path: entry.relativePath,
            change: "deleted",
            modifiedAt: null,
            hash: null,
            size: null,
          });
        }
        return;
      }
      if (!previous) {
        entry.identity = identity;
        this.emitEvent({
          cwd: entry.cwd,
          path: entry.relativePath,
          change: "recreated",
          modifiedAt: identity.modifiedAt,
          hash: identity.hash,
          size: identity.size,
        });
        return;
      }
      if (identity === previous) {
        return;
      }
      // Same content, new mtime (a touch): track the identity silently so the
      // next real change diffs against fresh state, but don't wake clients.
      entry.identity = identity;
      if (identity.hash === previous.hash) {
        return;
      }
      this.emitEvent({
        cwd: entry.cwd,
        path: entry.relativePath,
        change: "changed",
        modifiedAt: identity.modifiedAt,
        hash: identity.hash,
        size: identity.size,
      });
    } catch (error) {
      this.logger.debug({ err: error, path: entry.relativePath }, "File watch check failed");
    } finally {
      entry.checking = false;
      if (entry.recheck) {
        entry.recheck = false;
        this.scheduleCheck(key);
      }
    }
  }
}
