/**
 * Cooperative single-GPU scheduler: one resident model, many concurrent chats.
 *
 * There is exactly one place a job is ever started - `#dispatch`. Every event
 * that could change the answer (a submit, a job settling, a model finishing its
 * load, a slot poll) calls it again, and it re-derives the whole decision from
 * scratch. There is no worker pool, no parked promise, no wake generation and
 * no claim lock: the dispatcher is single-threaded by construction (`#busy`),
 * so the state it reads cannot move underneath it.
 *
 * The five variables it arbitrates, in the order it applies them:
 *
 *  1. RESIDENCY. Only one model is resident, so `#running` never mixes models.
 *     A switch happens only from a fully drained engine. Nothing that reaches
 *     the scheduler is ever refused for "wrong model loaded" - it is queued
 *     until its model is resident. Whether a switch is *allowed* at all is
 *     decided upstream by `decideModelGate`: with `config.lockModel` on, the
 *     host serves one pinned model and a request naming another is refused
 *     there with a 409, so the scheduler never sees it.
 *
 *  2. EXCLUSIVITY. Calibrate, sweep and benchmark own the engine alone: the
 *     engine drains before one starts, and nothing is admitted while it runs.
 *
 *  3. THE TURN, and what may join it. A turn takes every queued job of its
 *     model up to the first exclusive operation. When that batch drains the
 *     turn stays OPEN: a same-model job arriving a moment later joins it and
 *     takes a free slot immediately. That is the difference between two chats
 *     each holding their own slot and two chats trading one slot back and
 *     forth - the latter is what a closed per-turn batch produces, because
 *     agentic traffic arrives one request per chat per turn and never as a
 *     burst.
 *
 *  4. FAIRNESS. A turn stops absorbing the moment the queue head is another
 *     model's job or an exclusive operation. Since the queue is FIFO, "another
 *     model is waiting" means it is at the head, so a steady stream for model
 *     A cannot starve model B: B waits exactly as long as A's already-running
 *     jobs take, then the turn retires and B is picked (preferring a model
 *     other than the one that just ran).
 *
 *  5. CAPACITY. `parallelSlots` is the number of sequence slots llama-server
 *     was launched with and therefore the KV pool we own; `#running.size`
 *     against it is the hard bound. The measured free-slot count (llama-server's
 *     own `/slots`) is the second bound, and it exists to notice slots taken by
 *     traffic Otto did not schedule, or an engine mid-eviction. The two are
 *     combined as `min(ceiling - running, measured)` and never both subtracted:
 *     the engine's idle count already excludes our running jobs, so subtracting
 *     them from it a second time leaves zero capacity with a single chat live
 *     and silently serializes every other chat behind it.
 *
 * Ordering within a turn is session-affine: a job whose session already holds a
 * slot goes first, because that chat's KV state is what llama-server's
 * longest-common-prefix slot selection just filled, so it pays no re-prefill.
 * Session identity is the standard `prompt_cache_key`; clients that omit it get
 * plain FIFO.
 *
 * The scheduler is transport-agnostic: a job is a resolved catalog model plus a
 * `run()` that does the proxying, which keeps the logic unit-testable.
 */
import type { Model } from "../types.js";
import type { Profile } from "../config/schema.js";

const MAX_CONCURRENCY = 16;

/** The subset of the supervisor the scheduler observes to size and route turns. */
export interface SchedulerSupervisor {
  state: string;
  model: Model | null;
  profile: Profile | null;
}

export interface SchedulerOptions {
  supervisor: SchedulerSupervisor;
  loadModel: (model: Model) => Promise<void>;
  logger?: ((message: string) => void) | null;
  /**
   * Called whenever the queue depth or the turn changes - i.e. whenever
   * `stats()` would answer differently. The status event stream publishes from
   * this instead of sampling, so "queued behind a model switch" reaches the UI
   * the moment it becomes true rather than up to a poll later.
   */
  onChange?: (() => void) | null;
  /**
   * Live slot measurement: how many sequence slots llama-server actually has
   * free right now, or null when unknown (server not ready, sample failed).
   * See CAPACITY in the file header for how it combines with `parallelSlots`.
   * Absent means "trust the profile count".
   */
  freeSlots?: (() => Promise<number | null> | number | null) | null;
  /**
   * How long to wait before re-checking the engine when capacity is zero and
   * no job of ours is running - the only state where nothing else will wake
   * the dispatcher.
   */
  slotPollMs?: number;
}

/** Work kinds sharing the single resident model. Operations own a full turn. */
export type SchedulerJobKind = "completion" | "calibrate" | "sweep" | "benchmark";

export interface SchedulerSubmitOptions {
  kind?: SchedulerJobKind;
  /** An operation never shares its model turn with inference. */
  exclusive?: boolean;
  /** Called exactly when this job starts running, before `run()` is awaited. */
  onStart?: (() => void) | null;
  /**
   * The chat's stable identity (its `prompt_cache_key`). Jobs from a session
   * that already holds a slot run next in line for their model, so a resident
   * chat's KV cache is reused instead of evicted by a different chat. Absent
   * (third-party clients) means no affinity - plain FIFO.
   */
  session?: string | null;
}

/** A queued request or host operation bound to a resolved catalog model. */
export interface QueuedJob {
  modelId: string;
  model: Model;
  kind: SchedulerJobKind;
  exclusive: boolean;
  session: string | null;
  onStart: (() => void) | null;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export interface SchedulerStats {
  queued: number;
  waiting: Record<string, number>;
  /** Stable ids for host surfaces. Display names are not scheduler keys. */
  waitingModelIds: Record<string, number>;
  lastTurn: string | null;
  active: { modelId: string; kind: Exclude<SchedulerJobKind, "completion"> } | null;
}

export class Scheduler {
  supervisor: SchedulerSupervisor;
  loadModel: (model: Model) => Promise<void>;
  logger: ((message: string) => void) | null;
  /** Submitted, not yet claimed by a turn. */
  queue: QueuedJob[] = [];
  lastTurnId: string | null = null;
  /**
   * Per model: the session whose jobs most recently filled its slots. That
   * session's KV state is the one llama-server's LCP selection will match
   * against, so its queued jobs go first on the next dispatch.
   */
  hotSessions = new Map<string, string>();
  /** The exclusive operation in flight, if any. Reported by `stats()`. */
  activeJob: QueuedJob | null = null;
  onChange: (() => void) | null;
  freeSlots: SchedulerOptions["freeSlots"];
  slotPollMs: number;

  /** Claimed by the current turn, waiting for a slot. Empty between turns. */
  #batch: QueuedJob[] = [];
  /** Started, not yet settled. Invariant: every member's model is `#turnId`. */
  #running = new Set<QueuedJob>();
  /** The model that owns the engine for this turn, or null between turns. */
  #turnId: string | null = null;
  /** A dispatch pass is running. Only one may read/mutate the state at a time. */
  #busy = false;
  /** State changed mid-pass; run one more pass before yielding. */
  #dirty = false;
  #slotTimer: ReturnType<typeof setTimeout> | null = null;

  constructor({
    supervisor,
    loadModel,
    logger = null,
    onChange = null,
    freeSlots = null,
    slotPollMs = 2500,
  }: SchedulerOptions) {
    this.supervisor = supervisor;
    this.loadModel = loadModel; // async (model) => resolves once it is ready
    this.logger = logger; // optional (message: string) => void
    this.onChange = onChange;
    this.freeSlots = freeSlots;
    this.slotPollMs = slotPollMs;
  }

  /** Announce a queue/turn change. Never lets a status listener break a turn. */
  #announce(): void {
    try {
      this.onChange?.();
    } catch {
      // Status reporting is not allowed to fail a queued completion.
    }
  }

  /** Id of the model that is actually loaded and ready, or null. */
  get loadedId(): string | null {
    return this.supervisor.state === "ready" && this.supervisor.model
      ? this.supervisor.model.id
      : null;
  }

  /** How many requests may run at once against the resident model (static ceiling). */
  get concurrency(): number {
    return Math.max(1, Math.min(MAX_CONCURRENCY, this.supervisor.profile?.parallelSlots || 1));
  }

  /**
   * Queue a job for an already-resolved catalog model. `run` is invoked once
   * that model is the resident one; the returned promise settles when run does.
   * Dispatch is deferred a microtask so a burst of requests submitted together
   * shares one turn rather than the first one taking a turn by itself.
   */
  submit(
    model: Model,
    run: () => Promise<unknown>,
    {
      kind = "completion",
      exclusive = kind !== "completion",
      onStart = null,
      session = null,
    }: SchedulerSubmitOptions = {},
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        modelId: model.id,
        model,
        kind,
        exclusive,
        session: session ?? null,
        onStart,
        run,
        resolve,
        reject,
      });
      this.#announce();
      queueMicrotask(() => void this.#dispatch());
    });
  }

  /**
   * An exclusive operation is a hard boundary inside its model's queue.
   *  - At the head: it takes the turn alone.
   *  - Behind other jobs: those jobs take the turn; the operation (and
   *    everything behind it) stays queued until it is the head.
   */
  #takeTurn(turnId: string): QueuedJob[] {
    const taken: QueuedJob[] = [];
    for (const job of this.queue) {
      if (job.modelId !== turnId) continue;
      if (taken.length > 0 && job.exclusive) break; // boundary waits its turn
      taken.push(job);
      if (job.exclusive) break; // at the head: it runs solo
    }
    return this.#take((job) => taken.includes(job));
  }

  #take(pred: (job: QueuedJob) => boolean): QueuedJob[] {
    const kept: QueuedJob[] = [];
    const taken: QueuedJob[] = [];
    for (const job of this.queue) (pred(job) ? taken : kept).push(job);
    this.queue = kept;
    if (taken.length > 0) this.#announce();
    return taken;
  }

  /** Sessions that currently hold a slot, for affinity. */
  #warmSessions(): Set<string> {
    const warm = new Set<string>();
    for (const job of this.#running) if (job.session) warm.add(job.session);
    return warm;
  }

  /**
   * Pick which batched job goes next.
   *
   *  - While a session still holds a slot for this model, one of its jobs goes
   *    next: its KV state is what llama-server's LCP selection just filled, so
   *    dispatching it costs no eviction plus re-prefill.
   *  - Otherwise plain FIFO.
   *
   * (A batch never mixes an exclusive operation with other jobs - that split
   * happens in `#takeTurn` - so no boundary check is needed here.)
   */
  #claimJob(turnId: string): QueuedJob | null {
    if (this.#batch.length === 0) return null;
    const warm = this.#warmSessions();
    const chosen =
      warm.size > 0
        ? (this.#batch.find((job) => job.session !== null && warm.has(job.session)) ??
          this.#batch[0])
        : this.#batch[0];
    this.#batch.splice(this.#batch.indexOf(chosen), 1);
    if (chosen.session) this.hotSessions.set(turnId, chosen.session);
    return chosen;
  }

  /**
   * The engine's idle slot count, or null when it cannot be sampled - in which
   * case the static profile count is the best available answer rather than
   * "wait forever".
   */
  async #sampleFreeSlots(): Promise<number | null> {
    if (!this.freeSlots) return null;
    try {
      const free = await this.freeSlots();
      return free === null || Number.isNaN(free) ? null : Math.max(0, free);
    } catch {
      return null;
    }
  }

  /**
   * Re-check the engine after a delay. Only needed when capacity is zero and
   * nothing of ours is running: that is the one state where no settle callback
   * is coming, because the slots are held by traffic we did not schedule.
   */
  #pollForSlot(): void {
    if (this.#slotTimer) return;
    this.#slotTimer = setTimeout(() => {
      this.#slotTimer = null;
      void this.#dispatch();
    }, this.slotPollMs);
  }

  /**
   * Start a job and wire its completion back into the dispatcher. Never
   * awaited by the dispatcher: a pass decides and returns, and the settle
   * callback is what asks for the next decision.
   */
  #start(job: QueuedJob): void {
    this.#running.add(job);
    if (job.exclusive) this.activeJob = job;
    this.#announce();
    void (async () => {
      try {
        job.onStart?.();
        job.resolve(await job.run());
      } catch (error) {
        job.reject(error);
      } finally {
        this.#running.delete(job);
        if (this.activeJob === job) this.activeJob = null;
        this.#announce();
        void this.#dispatch();
      }
    })();
  }

  /**
   * Ask for a scheduling decision. Safe to call from anywhere, any number of
   * times: overlapping calls collapse into one more pass after the current one,
   * so the state a pass reads never moves underneath it.
   */
  async #dispatch(): Promise<void> {
    if (this.#busy) {
      this.#dirty = true;
      return;
    }
    this.#busy = true;
    try {
      do {
        this.#dirty = false;
        await this.#pass();
      } while (this.#dirty);
    } finally {
      this.#busy = false;
    }
  }

  /**
   * One decision pass: start as many jobs as residency, exclusivity, the turn
   * boundary and capacity allow, then return. Each iteration re-derives
   * everything, so there is no state to keep consistent between them.
   */
  async #pass(): Promise<void> {
    // The engine's idle count, sampled at most once per pass, plus how many
    // jobs this pass has started against it (the sample cannot see those yet).
    let measured: number | null = null;
    let sampled = false;
    let startedHere = 0;

    for (;;) {
      // An exclusive operation owns the engine alone.
      if (this.activeJob !== null) return;

      // 1. Between turns: a turn may only begin on a drained engine, because
      //    it may need a different model resident.
      if (this.#turnId === null) {
        if (this.#running.size > 0) return; // its settle callback re-dispatches
        if (this.queue.length === 0) return; // idle
        // Prefer a model other than the one that just ran, so two sides
        // alternate; fall back to the head when only one model is waiting.
        const pick = this.queue.find((job) => job.modelId !== this.lastTurnId) ?? this.queue[0];
        if (this.loadedId !== pick.modelId) {
          try {
            this.logger?.(`switching to ${pick.model.displayName}`);
            await this.loadModel(pick.model);
          } catch (error) {
            // The model would not load - fail exactly its queued jobs, move on.
            for (const job of this.#take((j) => j.modelId === pick.modelId)) job.reject(error);
            continue;
          }
          // A relaunched engine has all its slots back; the old sample is void.
          sampled = false;
          startedHere = 0;
        }
        this.#turnId = pick.modelId;
        this.lastTurnId = pick.modelId;
        this.#batch = this.#takeTurn(pick.modelId);
        this.#announce();
      }
      const turnId = this.#turnId;

      // 2. Batch drained: keep the turn open by absorbing the queue head when
      //    it belongs to this turn. This is what lets a steady stream of chats
      //    each hold their own slot instead of trading one.
      if (this.#batch.length === 0) {
        const head = this.queue[0];
        if (head !== undefined && !head.exclusive && head.modelId === turnId) {
          this.#batch = this.#take((job) => job === head);
        } else {
          // Boundary: another model's job, an exclusive operation, or nothing.
          // The turn ends as soon as its own jobs have drained.
          if (this.#running.size > 0) return;
          this.#turnId = null;
          this.#announce();
          if (this.queue.length === 0) return;
          continue; // pick the next turn
        }
      }

      // 3. An exclusive operation runs alone, on a drained engine.
      if (this.#batch.length === 1 && this.#batch[0].exclusive) {
        if (this.#running.size > 0) return;
        this.#start(this.#batch.shift()!);
        return;
      }

      // 4. Capacity. The ceiling is the KV pool we own; the measurement is
      //    there to notice slots taken by traffic we did not schedule. They
      //    are combined, never both subtracted - see CAPACITY in the header.
      if (!sampled) {
        measured = await this.#sampleFreeSlots();
        sampled = true;
      }
      const room = Math.min(
        this.concurrency - this.#running.size,
        measured === null ? Number.POSITIVE_INFINITY : measured - startedHere,
      );
      if (room < 1) {
        if (this.#running.size === 0) this.#pollForSlot();
        return;
      }

      // 5. Start the next job. Affinity decides which of the batch goes first.
      const job = this.#claimJob(turnId);
      if (!job) return;
      startedHere += 1;
      this.#start(job);
    }
  }

  /** Queue snapshot for the status endpoint / UI. */
  stats(): SchedulerStats {
    const waiting: Record<string, number> = {};
    const waitingModelIds: Record<string, number> = {};
    // Batched jobs have left the queue but have not started: to everyone
    // outside the scheduler they are still waiting.
    for (const job of [...this.queue, ...this.#batch]) {
      const name = job.model.displayName;
      waiting[name] = (waiting[name] || 0) + 1;
      waitingModelIds[job.modelId] = (waitingModelIds[job.modelId] || 0) + 1;
    }
    const active =
      this.activeJob && this.activeJob.kind !== "completion"
        ? { modelId: this.activeJob.modelId, kind: this.activeJob.kind }
        : null;
    return {
      queued: this.queue.length + this.#batch.length,
      waiting,
      waitingModelIds,
      lastTurn: this.lastTurnId,
      active,
    };
  }
}
