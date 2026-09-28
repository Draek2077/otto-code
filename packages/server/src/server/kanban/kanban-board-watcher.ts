/**
 * Keeps an open board in step with changes made outside Otto.
 *
 * This is a poller, and saying so is the point. Neither GitHub Projects nor Jira
 * can push to a daemon running on someone's laptop: GitHub's `projects_v2_item`
 * webhooks need a public endpoint to deliver to, and Otto does not open one. So
 * the daemon asks, on an interval, and the honest name for that is polling - not
 * "live", not "realtime".
 *
 * Two intervals, because a cheap change marker cannot be fully trusted:
 *
 *  - `POLL_INTERVAL_MS` reads the provider's revision marker. On GitHub that is
 *    `updatedAt` plus the item count, which is cheap but not documented to move
 *    for every field write.
 *  - `FORCE_INTERVAL_MS` announces a change regardless, so a board whose marker
 *    is stale still converges. This is the safety net that lets the cheap marker
 *    be merely a hint.
 *
 * A notification only ever says "re-read this board". The client re-reads rather
 * than patching, so a missed or duplicated notification costs a round trip and
 * never correctness.
 */

/** How often a watched board's revision marker is read. */
export const POLL_INTERVAL_MS = 30_000;
/** How long a board may go without a re-read, however quiet its marker looks. */
export const FORCE_INTERVAL_MS = 5 * 60_000;

export interface KanbanBoardWatcherHost {
  onChanged(input: { providerId: string; boardId: string; revision?: string }): void;
  log: { error: (message: string, error?: unknown) => void };
}

interface WatchEntry {
  timer: ReturnType<typeof setInterval>;
  lastRevision: string | null;
  lastAnnouncedAt: number;
  /** Set while a poll is in flight, so a slow provider cannot pile up requests. */
  polling: boolean;
}

export interface KanbanBoardWatcherOptions {
  host: KanbanBoardWatcherHost;
  pollIntervalMs?: number;
  forceIntervalMs?: number;
  /** Injectable so tests drive the clock instead of waiting on it. */
  now?: () => number;
}

export class KanbanBoardWatcher {
  private readonly entries = new Map<string, WatchEntry>();
  private readonly host: KanbanBoardWatcherHost;
  private readonly pollIntervalMs: number;
  private readonly forceIntervalMs: number;
  private readonly now: () => number;

  public constructor(options: KanbanBoardWatcherOptions) {
    this.host = options.host;
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.forceIntervalMs = options.forceIntervalMs ?? FORCE_INTERVAL_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Starts watching, or leaves an existing watch alone. Returns the interval so
   * the client can tell the user how fresh the board actually is.
   */
  public watch(
    providerId: string,
    boardId: string,
    readRevision: () => Promise<string | null>,
  ): number {
    const key = watchKey(providerId, boardId);
    if (this.entries.has(key)) {
      return this.pollIntervalMs;
    }
    const entry: WatchEntry = {
      timer: setInterval(() => {
        void this.poll(key, providerId, boardId, readRevision);
      }, this.pollIntervalMs),
      // The board was just read by whoever opened it, so the first poll compares
      // against that read rather than announcing a change immediately.
      lastRevision: null,
      lastAnnouncedAt: this.now(),
      polling: false,
    };
    // A daemon-side interval must never be the reason a process stays alive.
    entry.timer.unref?.();
    this.entries.set(key, entry);
    return this.pollIntervalMs;
  }

  public unwatch(providerId: string, boardId: string): void {
    const key = watchKey(providerId, boardId);
    const entry = this.entries.get(key);
    if (entry) {
      clearInterval(entry.timer);
      this.entries.delete(key);
    }
  }

  public dispose(): void {
    for (const entry of this.entries.values()) {
      clearInterval(entry.timer);
    }
    this.entries.clear();
  }

  private async poll(
    key: string,
    providerId: string,
    boardId: string,
    readRevision: () => Promise<string | null>,
  ): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry || entry.polling) {
      return;
    }
    entry.polling = true;
    try {
      const revision = await readRevision();
      // The entry can be dropped while the request is in flight, and announcing
      // then would push a change for a board nobody is watching any more.
      if (!this.entries.has(key)) {
        return;
      }
      // The first successful poll only establishes the baseline: without this,
      // every board would refresh itself once, pointlessly, 30 seconds after it
      // was opened.
      const baselineKnown = entry.lastRevision !== null;
      const moved = revision !== null && baselineKnown && revision !== entry.lastRevision;
      if (revision !== null) {
        entry.lastRevision = revision;
      }
      // A provider that cannot report a revision leaves `moved` false forever,
      // so the force interval becomes its only refresh. That is the intended
      // degradation, not a gap.
      const stale = this.now() - entry.lastAnnouncedAt >= this.forceIntervalMs;
      if (!moved && !stale) {
        return;
      }
      entry.lastAnnouncedAt = this.now();
      this.host.onChanged({
        providerId,
        boardId,
        ...(revision ? { revision } : {}),
      });
    } catch (error) {
      // A board that has become unreadable (revoked scope, deleted project) must
      // not turn into an error every interval; the next board read reports it.
      this.host.log.error(`kanban board watch poll failed for ${boardId}`, error);
    } finally {
      const current = this.entries.get(key);
      if (current) {
        current.polling = false;
      }
    }
  }
}

function watchKey(providerId: string, boardId: string): string {
  return `${providerId}::${boardId}`;
}
