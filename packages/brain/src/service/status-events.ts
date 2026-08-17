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
 * How often the publisher resamples while work is actually in flight.
 *
 * A sample is needed at all because only two inputs have no event to hang off:
 * `activity` is a file written by a *different* process (a `calibrate` or
 * `pull` CLI run), and the per-slot token rates are a loopback read of
 * llama-server's `/slots`. **Everything a user reads as state already arrives
 * by push** - stage transitions call `notify()` through
 * `reasoningTracker.onChange`, the scheduler through `onChange`, the supervisor
 * on `state` and `crashed`. So this timer is not what makes the UI feel live;
 * it only refreshes two numbers.
 *
 * It used to be 250ms (4 Hz), which cost a loopback GET to llama-server four
 * times a second for the entire time a daemon was subscribed - including while
 * the brain sat completely idle. `/slots` is served off llama-server's own task
 * queue, so that traffic competes with the decoding it is reporting on, and the
 * brain is already the heaviest thing on the machine. One second is well inside
 * what a rounded tok/s readout can show (the rate is held between samples, see
 * `SlotActivityTracker`), and it cuts the busy-path sampling by 4x.
 */
const DEFAULT_SAMPLE_INTERVAL_MS = 1_000;

/**
 * How often to resample when nothing is running.
 *
 * With no request in flight, no queued job and no operation, the only thing a
 * sample can discover is a `calibrate`/`pull` starting in another process -
 * long jobs whose progress bar is not harmed by appearing a few seconds in.
 * Everything else that could change is pushed. Polling an idle engine four
 * times a second was pure waste: 14,400 loopback requests an hour to report
 * that nothing happened.
 */
const DEFAULT_IDLE_INTERVAL_MS = 5_000;

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
  /** Resample cadence while work is in flight. See DEFAULT_SAMPLE_INTERVAL_MS. */
  sampleIntervalMs?: number;
  /** Resample cadence while idle. See DEFAULT_IDLE_INTERVAL_MS. */
  idleIntervalMs?: number;
}

/**
 * Whether the last snapshot showed anything worth sampling quickly for.
 *
 * Read from the snapshot itself rather than tracked separately, so the cadence
 * can never disagree with what was last published. Busy means one of:
 * a request is dispatched or queued (the per-slot rates are moving), an
 * operation is running (`activity` carries a progress bar), or the engine is
 * between states (`ready` is the only settled one that serves traffic).
 *
 * Erring towards "busy" is the safe direction - it costs a sample, where the
 * opposite would freeze a moving number - so an unreadable snapshot counts as
 * busy.
 */
function isBusySnapshot(snapshot: BrainStatusSnapshot): boolean {
  if (snapshot.activity != null) return true;
  const queued = snapshot.queued;
  if (typeof queued === "number" && queued > 0) return true;
  const inference = isRecord(snapshot.inference) ? snapshot.inference : null;
  if (inference) {
    for (const key of ["activeRequests", "processing", "thinking", "generating"]) {
      const value = inference[key];
      if (typeof value === "number" && value > 0) return true;
    }
  }
  const state = snapshot.state;
  // A settled engine that is not serving anything: "ready" idles here, and
  // "stopped" has no engine to poll at all. Anything else is mid-transition
  // (starting, loading) and worth watching closely.
  return typeof state === "string" && state !== "ready" && state !== "stopped";
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
  readonly #idleIntervalMs: number;
  #source: (() => Promise<BrainStatusSnapshot>) | null = null;
  #timer: NodeJS.Timeout | null = null;
  /** The cadence the running timer was armed at, so it is only re-armed on change. */
  #timerDelayMs: number | null = null;
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
    // Never slower than the busy cadence: a caller that asks for a slow busy
    // poll means "sample rarely", and an idle default below it would speed the
    // idle path up instead.
    this.#idleIntervalMs = Math.max(
      options.idleIntervalMs ?? DEFAULT_IDLE_INTERVAL_MS,
      this.#sampleIntervalMs,
    );
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
    // Start at the busy cadence; the sample below settles it. Guessing high for
    // one tick costs a single loopback read, where guessing low could leave a
    // subscriber that arrived mid-generation waiting out the idle interval.
    this.#armTimer(this.#sampleIntervalMs);
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
      // Re-pace from what was actually observed, before the unchanged-snapshot
      // return below - an idle brain reports "nothing changed" every time, and
      // that is exactly the case whose cadence needs to back off.
      this.#armTimer(isBusySnapshot(snapshot) ? this.#sampleIntervalMs : this.#idleIntervalMs);
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

  /**
   * Arm the resample timer at `delayMs`, replacing a timer running at a
   * different cadence.
   *
   * Re-arming only on an actual cadence change keeps the steady state a plain
   * interval - a busy brain does not tear down and rebuild a timer every
   * second - while a busy/idle transition takes effect on the next tick rather
   * than waiting out the old one.
   */
  #armTimer(delayMs: number): void {
    if (this.#closed || this.#listeners.size === 0) return;
    if (this.#timer && this.#timerDelayMs === delayMs) return;
    this.#stopTimer();
    this.#timerDelayMs = delayMs;
    this.#timer = setInterval(() => this.notify(), delayMs);
    // Never hold the process open for status reporting alone.
    this.#timer.unref?.();
  }

  #stopTimer(): void {
    if (!this.#timer) return;
    clearInterval(this.#timer);
    this.#timer = null;
    this.#timerDelayMs = null;
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
