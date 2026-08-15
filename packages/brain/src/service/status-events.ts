/**
 * The brain's authoritative status event source.
 *
 * The brain owns its own state, so it publishes it rather than being polled for
 * it. One daemon subscribes over SSE (`GET /__host/events`) and fans the result
 * out to every connected Otto client, replacing a per-client status poll that
 * could never show a transition sooner than its own interval.
 *
 * Three properties this has to keep:
 *
 *  - **Complete snapshots, never deltas.** A reader that missed an event, or
 *    reconnected after one, must not have to reconstruct anything: the newest
 *    snapshot is the whole truth. That is what makes reconnect repair on both
 *    sides idempotent.
 *  - **Coalescing lives here, not in the reader.** A timer tick that finds
 *    nothing changed emits nothing, and a completion's traffic counters are not
 *    a state change. Otherwise "push" would just be a poll with extra steps, and
 *    a busy brain would broadcast to every client for every token.
 *  - **No work while nobody is listening.** The sampler only runs while a
 *    subscriber is attached, so a brain the daemon never subscribed to (an older
 *    daemon, or one that is not running) pays nothing.
 *
 * The snapshot itself is deliberately the *cheap* status: no `resources`, whose
 * collection spawns `nvidia-smi`. That stays an opt-in pull for the Overview tab.
 */

/** A complete cheap `/__host/status` body. Opaque here; the router assembles it. */
export type BrainStatusSnapshot = Record<string, unknown>;

export type BrainStatusListener = (snapshot: BrainStatusSnapshot) => void;
export type BrainLogListener = (line: string) => void;

/**
 * How often the publisher resamples while at least one listener is attached.
 *
 * A sample is needed at all because two inputs have no event to hang off:
 * `activity` is a file written by a *different* process (a `calibrate` or
 * `pull` CLI run), and the slot phase split is a loopback read of
 * llama-server's `/slots`. Everything else notifies directly. Sampling is not
 * a heartbeat: an unchanged sample emits nothing.
 */
const DEFAULT_SAMPLE_INTERVAL_MS = 250;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The fields whose change is worth waking every connected client for.
 *
 * Everything omitted here still rides in the payload; it just cannot *trigger*
 * a payload on its own. The omissions are the churning ones:
 *
 *  - `telemetry` totals and `recent` advance on every completion.
 *  - `logLineCount` advances on every llama-server log line.
 *  - `slots.contexts` is capacity detail that changes independently of work.
 *
 * `slots.threads` is intentionally included. It is sampled at a bounded 4 Hz,
 * not notified per model token, so it gives the Overview live counts and rates
 * without turning a fast model into a token-rate broadcast.
 *
 * `telemetry.warning` is kept: the reasoning-only advice is a state the UI
 * shows, not a counter.
 */
export function statusChangeKey(snapshot: BrainStatusSnapshot): string {
  const scheduler = isRecord(snapshot.scheduler) ? snapshot.scheduler : null;
  const telemetry = isRecord(snapshot.telemetry) ? snapshot.telemetry : null;
  const slots = isRecord(snapshot.slots) ? snapshot.slots : null;
  return JSON.stringify({
    version: snapshot.version ?? null,
    apiVersion: snapshot.apiVersion ?? null,
    state: snapshot.state ?? null,
    model: snapshot.model ?? null,
    modelId: snapshot.modelId ?? null,
    pid: snapshot.pid ?? null,
    vramBytes: snapshot.vramBytes ?? null,
    loadSeconds: snapshot.loadSeconds ?? null,
    startedAt: snapshot.startedAt ?? null,
    lastError: snapshot.lastError ?? null,
    upstream: snapshot.upstream ?? null,
    runtime: snapshot.runtime ?? null,
    capabilities: snapshot.capabilities ?? null,
    activity: snapshot.activity ?? null,
    reasoning: snapshot.reasoning ?? null,
    inference: snapshot.inference ?? null,
    queued: snapshot.queued ?? null,
    schedulerWaiting: scheduler?.waiting ?? null,
    schedulerLastTurn: scheduler?.lastTurn ?? null,
    warning: telemetry?.warning ?? null,
    slots: slots
      ? {
          total: slots.total ?? null,
          busy: slots.busy ?? null,
          idle: slots.idle ?? null,
          prefill: slots.prefill ?? null,
          decode: slots.decode ?? null,
          threads: slots.threads ?? null,
        }
      : null,
  });
}

export interface BrainStatusPublisherOptions {
  /** Resample cadence while subscribed. See DEFAULT_SAMPLE_INTERVAL_MS. */
  sampleIntervalMs?: number;
}

/**
 * Owns the current snapshot and decides when it changed.
 *
 * Constructed before the router (so `serve.ts` can hand the same instance to
 * both the router and the management API) and inert until the router installs
 * the snapshot source with {@link setSource}. `/__host/capabilities` advertises
 * `events` only once it is {@link ready}, so a brain can never claim a stream it
 * cannot actually serve.
 */
export class BrainStatusPublisher {
  readonly #listeners = new Set<BrainStatusListener>();
  /** Per-subscription teardown, so `close()` can end the responses it feeds. */
  readonly #closers = new Set<() => void>();
  readonly #sampleIntervalMs: number;
  #source: (() => Promise<BrainStatusSnapshot>) | null = null;
  #timer: NodeJS.Timeout | null = null;
  /** The last snapshot that was actually emitted, replayed to a late subscriber. */
  #last: BrainStatusSnapshot | null = null;
  #lastKey: string | null = null;
  /** True while a sample is in flight, so overlapping triggers collapse into one. */
  #sampling = false;
  /** A trigger that arrived mid-sample; runs exactly one more sample afterwards. */
  #resample = false;
  #closed = false;

  constructor(options: BrainStatusPublisherOptions = {}) {
    this.#sampleIntervalMs = options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;
  }

  /** Whether a snapshot source has been installed - i.e. events can be served. */
  get ready(): boolean {
    return this.#source !== null && !this.#closed;
  }

  get listenerCount(): number {
    return this.#listeners.size;
  }

  /** Install the snapshot builder. Called once, by the router. */
  setSource(source: () => Promise<BrainStatusSnapshot>): void {
    this.#source = source;
  }

  /**
   * Attach a listener. It receives the current snapshot immediately when one is
   * known, and a fresh sample is taken right away so a subscriber that arrives
   * during a transition is not handed a stale first frame.
   */
  subscribe(listener: BrainStatusListener, onClose?: () => void): () => void {
    if (this.#closed) {
      onClose?.();
      return () => {};
    }
    this.#listeners.add(listener);
    if (onClose) this.#closers.add(onClose);
    if (this.#last) listener(this.#last);
    this.#startTimer();
    this.notify();
    return () => {
      this.#listeners.delete(listener);
      if (onClose) this.#closers.delete(onClose);
      if (this.#listeners.size === 0) this.#stopTimer();
    };
  }

  /**
   * Something authoritative changed - resample now rather than at the next tick.
   * Cheap to over-call: an unchanged snapshot emits nothing.
   */
  notify(): void {
    if (this.#closed || this.#listeners.size === 0) return;
    void this.#sample();
  }

  /**
   * Drop every listener and end the streams behind them.
   *
   * Ending them is not optional at shutdown: an open SSE response is an open
   * connection, and `server.close()` waits for those, so a brain that only
   * unsubscribed would hang on stop until its daemon happened to disconnect.
   */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#stopTimer();
    this.#listeners.clear();
    const closers = [...this.#closers];
    this.#closers.clear();
    for (const onClose of closers) {
      try {
        onClose();
      } catch {
        // Shutdown must not be blocked by one stream failing to end.
      }
    }
  }

  async #sample(): Promise<void> {
    const source = this.#source;
    if (!source || this.#closed) return;
    if (this.#sampling) {
      this.#resample = true;
      return;
    }
    this.#sampling = true;
    try {
      const snapshot = await source();
      if (this.#closed) return;
      const key = statusChangeKey(snapshot);
      // Always keep the newest body for replay, even when nothing significant
      // changed: a late subscriber should not get last minute's counters.
      this.#last = snapshot;
      if (key === this.#lastKey) return;
      this.#lastKey = key;
      // Set iteration tolerates a listener unsubscribing mid-emit, which the
      // SSE teardown does when a daemon disconnects during a snapshot.
      for (const listener of this.#listeners) {
        try {
          listener(snapshot);
        } catch {
          // A broken listener is that listener's problem; the others still get it.
        }
      }
    } catch {
      // A failed sample is not a state change. The next tick tries again.
    } finally {
      this.#sampling = false;
      if (this.#resample) {
        this.#resample = false;
        void this.#sample();
      }
    }
  }

  #startTimer(): void {
    if (this.#timer || this.#closed) return;
    this.#timer = setInterval(() => this.notify(), this.#sampleIntervalMs);
    // Never hold the process open for status reporting alone.
    this.#timer.unref?.();
  }

  #stopTimer(): void {
    if (!this.#timer) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }
}

/**
 * Pushes every completed Brain log line immediately. Unlike status snapshots,
 * log lines are an ordered append-only stream, so coalescing would lose the
 * exact evidence the Logs tab exists to show.
 */
export class BrainLogPublisher {
  readonly #listeners = new Set<BrainLogListener>();

  subscribe(listener: BrainLogListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  publish(line: string): void {
    for (const listener of this.#listeners) {
      try {
        listener(line);
      } catch {
        // One dead client must not interrupt the service log.
      }
    }
  }
}
