import { randomUUID } from "node:crypto";

/**
 * The nonsecret identity of one browser authorization attempt. Its associated
 * verifier, callback server, and any provider state remain daemon memory only.
 */
export interface BrowserAuthorizationAttempt {
  id: string;
  key: string;
  startedAt: number;
}

export interface BrowserAuthorizationAttemptStart<T> {
  value: T;
  /** Stops the provider's callback listener and releases its in-memory state. */
  cancel(): void | Promise<void>;
}

interface ActiveAttempt<T> {
  attempt: BrowserAuthorizationAttempt;
  value: T | undefined;
  cancel: (() => void | Promise<void>) | undefined;
  timer: NodeJS.Timeout | undefined;
  onTimeout: (attempt: BrowserAuthorizationAttempt) => void | Promise<void>;
}

/**
 * Daemon-owned lifecycle for a browser sign-in attempt.
 *
 * Starting a new attempt for the same key intentionally replaces the old one.
 * This never controls the user's browser, tabs, or vendor session: it only
 * releases Otto's callback listener and in-memory PKCE state. Callers use the
 * generated id to reject callbacks from an older attempt without allowing one
 * of those callbacks to cancel the current attempt.
 */
export class BrowserAuthorizationAttemptManager<T> {
  private readonly active = new Map<string, ActiveAttempt<T>>();
  private readonly latest = new Map<string, string>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  async replace(params: {
    key: string;
    timeoutMs: number;
    start: (attempt: BrowserAuthorizationAttempt) => Promise<BrowserAuthorizationAttemptStart<T>>;
    onTimeout: (attempt: BrowserAuthorizationAttempt) => void | Promise<void>;
  }): Promise<{ attempt: BrowserAuthorizationAttempt; value: T }> {
    await this.cancel(params.key);

    const attempt: BrowserAuthorizationAttempt = {
      id: randomUUID(),
      key: params.key,
      startedAt: this.now(),
    };
    const active: ActiveAttempt<T> = {
      attempt,
      value: undefined,
      cancel: undefined,
      timer: undefined,
      onTimeout: params.onTimeout,
    };
    this.latest.set(params.key, attempt.id);
    this.active.set(params.key, active);

    let started: BrowserAuthorizationAttemptStart<T>;
    try {
      started = await params.start(attempt);
    } catch (error) {
      if (this.active.get(params.key) === active) {
        this.active.delete(params.key);
      }
      throw error;
    }

    if (this.active.get(params.key) !== active) {
      await started.cancel();
      throw new BrowserAuthorizationAttemptSupersededError();
    }

    active.value = started.value;
    active.cancel = started.cancel;
    active.timer = setTimeout(() => {
      void this.expire(params.key, attempt.id);
    }, params.timeoutMs);
    active.timer.unref();
    return { attempt, value: started.value };
  }

  /** Returns daemon-only state when this is still the current attempt. */
  get(key: string, attemptId: string): { attempt: BrowserAuthorizationAttempt; value: T } | null {
    const active = this.active.get(key);
    if (!active || active.attempt.id !== attemptId || active.value === undefined) {
      return null;
    }
    return { attempt: active.attempt, value: active.value };
  }

  /** True until a later attempt replaces this one, including while it settles. */
  isLatest(key: string, attemptId: string): boolean {
    return this.latest.get(key) === attemptId;
  }

  /**
   * Removes the current attempt and gives its owner the callback cleanup. A
   * stale attempt id returns null and therefore cannot disturb a newer sign-in.
   */
  take(
    key: string,
    attemptId: string,
  ): {
    attempt: BrowserAuthorizationAttempt;
    value: T;
    cancel: () => void | Promise<void>;
    onTimeout: (attempt: BrowserAuthorizationAttempt) => void | Promise<void>;
  } | null {
    const active = this.active.get(key);
    if (
      !active ||
      active.attempt.id !== attemptId ||
      active.value === undefined ||
      active.cancel === undefined
    ) {
      return null;
    }
    this.active.delete(key);
    if (active.timer) clearTimeout(active.timer);
    return {
      attempt: active.attempt,
      value: active.value,
      cancel: active.cancel,
      onTimeout: active.onTimeout,
    };
  }

  async cancel(key: string): Promise<void> {
    const active = this.active.get(key);
    if (!active) return;
    this.active.delete(key);
    if (active.timer) clearTimeout(active.timer);
    await active.cancel?.();
  }

  private async expire(key: string, attemptId: string): Promise<void> {
    const released = this.take(key, attemptId);
    if (!released) return;
    await released.cancel();
    try {
      await released.onTimeout(released.attempt);
    } catch {
      // Failure to record a timeout cannot keep a listener or verifier alive.
    }
  }
}

export class BrowserAuthorizationAttemptSupersededError extends Error {
  constructor() {
    super("This sign-in attempt was replaced by a newer one.");
    this.name = "BrowserAuthorizationAttemptSupersededError";
  }
}
