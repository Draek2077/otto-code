import { watch as fsWatch, type FSWatcher } from "node:fs";
import path from "node:path";
import type pino from "pino";
import { resolveExplorerFileIdentity, type ExplorerFileIdentity } from "./service.js";

// Per-session watcher for files open in editor/viewer tabs. Uses fs.watch on
// the parent directory (survives atomic rename-replace writes and detects
// delete/recreate) with a batch polling fallback - the proven pattern from
// artifact-watcher.ts. Events fire only when the content identity actually
// changed: a bare mtime touch with an identical hash is swallowed.
//
// Polling runs even while fs.watch is healthy, on purpose: on WSL paths reached
// from Windows, network shares and container bind mounts the watcher can open
// cleanly and then never fire, and nothing tells us so. The poll is one stat per
// open file; the file is only read when its mtime or size moved.

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_DEBOUNCE_MS = 200;
// Above this, a change is detected from mtime and size alone. Hashing exists to
// swallow touches that leave the content alone; for a large file that keeps
// changing (a log being appended to) it meant reading and hashing the whole file
// on every change, which is exactly the file where that costs the most.
const DEFAULT_MAX_HASH_BYTES = 2 * 1024 * 1024;

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
  maxHashBytes?: number;
  /** Test hook: observe the directory watchers this class opens. */
  watchDirectory?: (directory: string, onChange: (fileName: string | null) => void) => FSWatcher;
}

function watchDirectoryWithFs(
  directory: string,
  onChange: (fileName: string | null) => void,
): FSWatcher {
  return fsWatch(directory, { persistent: false }, (_eventType, changedName) => {
    onChange(changedName ? changedName.toString() : null);
  });
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
  private readonly maxHashBytes: number;
  private readonly watchDirectory: NonNullable<SessionFileWatcherOptions["watchDirectory"]>;
  private readonly entries = new Map<string, WatchEntry>();
  // A subscribe awaits a stat before its entry exists. Without these, two
  // subscribes for one file in that window (a reconnect resubscribing while the
  // component resubscribes too) each opened a directory watcher, and the one
  // overwritten in `entries` was never closed.
  private readonly pending = new Map<string, Promise<void>>();
  private readonly cancelledPending = new Set<string>();
  private disposed = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SessionFileWatcherOptions) {
    this.emitEvent = options.emitEvent;
    this.logger = options.logger.child({ module: "session-file-watcher" });
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.maxHashBytes = options.maxHashBytes ?? DEFAULT_MAX_HASH_BYTES;
    this.watchDirectory = options.watchDirectory ?? watchDirectoryWithFs;
  }

  /** Idempotent per (cwd, path). Throws on containment violations. */
  async subscribe(input: { cwd: string; path: string }): Promise<void> {
    const key = buildWatchKey(input);
    if (this.entries.has(key)) {
      return;
    }
    const inFlight = this.pending.get(key);
    if (inFlight) {
      // A later subscribe outranks an unsubscribe that arrived in between.
      this.cancelledPending.delete(key);
      return inFlight;
    }
    const opening = this.open(key, input).finally(() => {
      this.pending.delete(key);
      this.cancelledPending.delete(key);
    });
    this.pending.set(key, opening);
    return opening;
  }

  private async open(key: string, input: { cwd: string; path: string }): Promise<void> {
    const resolved = await resolveExplorerFileIdentity({
      root: input.cwd,
      relativePath: input.path,
      maxHashBytes: this.maxHashBytes,
    });
    if (this.disposed || this.cancelledPending.has(key)) {
      return;
    }
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
      entry.dirWatcher = this.watchDirectory(path.dirname(resolved.resolvedPath), (changedName) => {
        // Some platforms omit the filename; check on every ambiguous event.
        if (!changedName || changedName === fileName) {
          this.scheduleCheck(key);
        }
      });
      // An FSWatcher with no error listener throws on its error event, which
      // takes the daemon down - and deleting the watched directory (archiving a
      // worktree with a tab open) is enough to raise one. Polling carries on.
      entry.dirWatcher.on("error", (error) => {
        this.logger.warn(
          { err: error, path: input.path },
          "fs.watch failed for watched file; relying on polling fallback",
        );
        entry.dirWatcher?.close();
        entry.dirWatcher = null;
      });
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
      if (this.pending.has(key)) {
        this.cancelledPending.add(key);
      }
      return;
    }
    this.cleanupEntry(entry);
    this.entries.delete(key);
    if (this.entries.size === 0) {
      this.stopPolling();
    }
  }

  dispose(): void {
    this.disposed = true;
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
        maxHashBytes: this.maxHashBytes,
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
      // next real change diffs against fresh state, but don't wake clients. A
      // file over the hashing limit has no hash to compare, so any mtime or size
      // change reports.
      entry.identity = identity;
      if (identity.hash !== null && identity.hash === previous.hash) {
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
