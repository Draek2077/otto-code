/**
 * How long a parked browser tab keeps rendering at full speed after it was last
 * presented or driven by an AI browser tool. It covers the usual gap between
 * consecutive tool calls in one task, so a page under active automation is not
 * backgrounded between steps, and quick tab switching never pays a wake.
 */
export const RESIDENT_BROWSER_BACKGROUND_AFTER_IDLE_MS = 30_000;

export interface ResidentBrowserActivityScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ResidentBrowserActivityOptions {
  /** Applies the backgrounded state to the browser's parked surface. */
  setBackgrounded(browserId: string, backgrounded: boolean): void;
  idleMs?: number;
  scheduler?: ResidentBrowserActivityScheduler;
}

/**
 * Wake/park state for resident browser guests. A tab is awake while it is
 * presented in a pane, while an AI operation is running against it, and for an
 * idle grace period after either ends; after that it is backgrounded. Waking is
 * synchronous, so an operation never starts against a backgrounded guest.
 */
export interface ResidentBrowserActivity {
  isBackgrounded(browserId: string): boolean;
  /** The tab is shown in a pane. */
  present(browserId: string): void;
  /** The tab left its pane (or was created without one). Starts the idle grace. */
  park(browserId: string): void;
  /**
   * Runs an operation with the tab awake. Untracked tabs (no resident guest,
   * for example a daemon-hosted page) run the operation unchanged.
   */
  runAwake<T>(browserId: string, operation: () => Promise<T>): Promise<T>;
  forget(browserId: string): void;
  reset(): void;
}

interface ResidentBrowserActivityEntry {
  presented: boolean;
  operations: number;
  backgrounded: boolean;
  idleTimer: unknown;
}

const defaultScheduler: ResidentBrowserActivityScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createResidentBrowserActivity(
  options: ResidentBrowserActivityOptions,
): ResidentBrowserActivity {
  const idleMs = options.idleMs ?? RESIDENT_BROWSER_BACKGROUND_AFTER_IDLE_MS;
  const scheduler = options.scheduler ?? defaultScheduler;
  const entries = new Map<string, ResidentBrowserActivityEntry>();

  function ensureEntry(browserId: string): ResidentBrowserActivityEntry {
    let entry = entries.get(browserId);
    if (!entry) {
      // A new guest starts awake: it attaches and paints its first frame in the
      // proven visible parking geometry, then backgrounds after the grace.
      entry = { presented: false, operations: 0, backgrounded: false, idleTimer: null };
      entries.set(browserId, entry);
    }
    return entry;
  }

  function cancelIdleTimer(entry: ResidentBrowserActivityEntry): void {
    if (entry.idleTimer !== null) {
      scheduler.clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
  }

  function isIdle(entry: ResidentBrowserActivityEntry): boolean {
    return !entry.presented && entry.operations === 0;
  }

  function wake(browserId: string, entry: ResidentBrowserActivityEntry): void {
    cancelIdleTimer(entry);
    if (entry.backgrounded) {
      entry.backgrounded = false;
      options.setBackgrounded(browserId, false);
    }
  }

  function armIdleTimer(browserId: string, entry: ResidentBrowserActivityEntry): void {
    cancelIdleTimer(entry);
    if (entry.backgrounded || !isIdle(entry)) {
      return;
    }
    entry.idleTimer = scheduler.setTimeout(() => {
      entry.idleTimer = null;
      if (entries.get(browserId) !== entry || entry.backgrounded || !isIdle(entry)) {
        return;
      }
      entry.backgrounded = true;
      options.setBackgrounded(browserId, true);
    }, idleMs);
  }

  return {
    isBackgrounded(browserId) {
      return entries.get(browserId)?.backgrounded ?? false;
    },

    present(browserId) {
      const entry = ensureEntry(browserId);
      entry.presented = true;
      wake(browserId, entry);
    },

    park(browserId) {
      const entry = ensureEntry(browserId);
      const wasPresented = entry.presented;
      entry.presented = false;
      // Re-parking an already parked tab is not activity: it must not extend
      // the grace of a tab that is quietly waiting to background.
      if (wasPresented || entry.idleTimer === null) {
        armIdleTimer(browserId, entry);
      }
    },

    async runAwake(browserId, operation) {
      const entry = entries.get(browserId);
      if (!entry) {
        return operation();
      }
      entry.operations += 1;
      wake(browserId, entry);
      try {
        return await operation();
      } finally {
        entry.operations -= 1;
        if (entries.get(browserId) === entry) {
          armIdleTimer(browserId, entry);
        }
      }
    },

    forget(browserId) {
      const entry = entries.get(browserId);
      if (entry) {
        cancelIdleTimer(entry);
        entries.delete(browserId);
      }
    },

    reset() {
      for (const entry of entries.values()) {
        cancelIdleTimer(entry);
      }
      entries.clear();
    },
  };
}
