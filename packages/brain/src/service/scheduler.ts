/**
 * Cooperative single-GPU scheduler with per-model concurrency.
 *
 * Only one model is resident at a time. Completion requests are queued rather
 * than refused for "wrong / no model loaded".
 *
 *  - Requests for the resident model run concurrently, up to the resident
 *    model's `parallelSlots` (the number of sequence slots llama-server was
 *    launched with). The static profile value sizes the KV pool at launch;
 *    dispatch is additionally gated on the *measured* free-slot count (the
 *    `freeSlots` source, sampled from llama-server's `/slots`), so the
 *    scheduler never over-commits the GPU while llama-server is mid-eviction,
 *    mid-swap, or simply saturated. Extra same-model requests wait for a free
 *    slot; they never trigger a load.
 *  - Requests for a *different* model wait for a model switch. When the resident
 *    model's current batch drains, the scheduler switches and serves the other
 *    model's batch - so two clients wanting different models share the GPU by
 *    taking turns.
 *
 * Ordering:
 *  - Session affinity: a job carries the chat's stable `prompt_cache_key`.
 *    While that session holds a slot, the next turn for the same model prefers
 *    its queued jobs - the chat's KV cache is still resident, so it pays no
 *    re-prefill. A different session goes first only when no in-flight job
 *    from another session is holding the slot.
 *  - Model fairness: after a model finishes a turn, the next turn prefers a
 *    *different* model when one is waiting, so a steady stream for model A
 *    cannot starve model B. A turn is a snapshot: requests that arrive for a
 *    model mid-turn wait for its next turn.
 *
 * The scheduler is transport-agnostic: a job is a resolved catalog model plus a
 * `run()` that does the proxying, which keeps the turn logic unit-testable.
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
   * The static `parallelSlots` sizes the KV pool at launch; this gate stops
   * the scheduler from dispatching ahead of what the engine can hold - the
   * over-commit that turns a healthy queue into a wedged one. Absent means
   * "trust the profile count".
   */
  freeSlots?: (() => Promise<number | null> | number | null) | null;
  /** How long to wait between free-slot re-checks while a batch is queued. */
  slotPollMs?: number;
}

/** Work kinds sharing the single resident model. Operations own a full turn. */
export type SchedulerJobKind = "completion" | "calibrate" | "sweep" | "benchmark";

export interface SchedulerSubmitOptions {
  kind?: SchedulerJobKind;
  /** An operation never shares its model turn with inference. */
  exclusive?: boolean;
  /** Called exactly when this request becomes the active turn. */
  onStart?: (() => void) | null;
  /**
   * The chat's stable identity (its `prompt_cache_key`). Jobs from the same
   * session that already hold a slot run next in line for their model, so a
   * resident chat's KV cache is reused instead of evicted by a different chat.
   * Absent (third-party clients) means no affinity - plain model fairness.
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
  loadModel: (model: Model) => Promise<void>; // async (model) => resolves once it is ready
  logger: ((message: string) => void) | null; // optional (message: string) => void
  queue: QueuedJob[]; // { modelId, model, run, resolve, reject }
  lastTurnId: string | null;
  /**
   * Per model: the session whose jobs most recently filled its slots. That
   * session's KV state is the one llama-server's LCP selection will match
   * against, so its queued jobs go first on the next turn.
   */
  hotSessions: Map<string, string>;
  activeJob: QueuedJob | null;
  pumping: boolean;
  onChange: (() => void) | null;
  freeSlots: SchedulerOptions["freeSlots"];
  slotPollMs: number;
  #claimLock: Promise<void> = Promise.resolve();

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
    this.queue = []; // { modelId, model, run, resolve, reject }
    this.lastTurnId = null;
    this.hotSessions = new Map();
    this.activeJob = null;
    this.pumping = false;
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
   * Live free-slot count for the resident model, or the static ceiling when no
   * sampler is wired. `freeSlots` returns null when the engine cannot be
   * sampled - in that case the static profile count is the best available
   * answer rather than "wait forever".
   */
  async #freeSlotCount(): Promise<number> {
    if (!this.freeSlots) return this.concurrency;
    try {
      const free = await this.freeSlots();
      return free === null || Number.isNaN(free) ? this.concurrency : Math.max(0, free);
    } catch {
      return this.concurrency;
    }
  }

  /**
   * Queue a job for an already-resolved catalog model. `run` is invoked once
   * that model is the resident one; the returned promise settles when run does.
   * Pumping is deferred a microtask so a burst of requests submitted together
   * share one turn rather than the first one snapshotting a turn by itself.
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
      queueMicrotask(() => this.pump());
    });
  }

  /**
   * An exclusive operation is a hard boundary inside its model's request queue.
   *  - At the queue head: it takes the turn alone.
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

  /**
   * Atomically claim the next job a worker may dispatch from a turn's
   * snapshot, or null when the snapshot is drained:
   *
   *  - While `active` sessions still hold slots of this model, a job from one
   *    of them goes next - its KV state is what llama-server's LCP selection
   *    just filled, so dispatching it costs no eviction + re-prefill.
   *  - No active session (or none with a queued job): plain FIFO.
   *
   * (A snapshot never mixes an exclusive operation with other jobs - that
   * split happens in `#takeTurn` - so no boundary check is needed here.)
   * Called under `#claimLock` so two workers cannot claim the same job.
   */
  #claimJob(snapshot: QueuedJob[], active: Set<string>, turnId: string): QueuedJob | null {
    if (snapshot.length === 0) return null;
    let chosen: QueuedJob;
    if (active.size > 0) {
      chosen = snapshot.find((j) => j.session !== null && active.has(j.session)) ?? snapshot[0];
    } else {
      chosen = snapshot[0];
    }
    snapshot.splice(snapshot.indexOf(chosen), 1);
    if (chosen.session) {
      active.add(chosen.session);
      this.hotSessions.set(turnId, chosen.session);
    }
    return chosen;
  }

  /** Serialize job claims across concurrent workers. */
  async #withClaimLock<T>(fn: () => T): Promise<T> {
    const previous = this.#claimLock;
    let release!: () => void;
    this.#claimLock = new Promise((resolve) => (release = resolve));
    await previous;
    try {
      return fn();
    } finally {
      release();
    }
  }

  /** Wait (no deadline) until the engine reports at least one free slot. */
  async #awaitSlot(): Promise<void> {
    while ((await this.#freeSlotCount()) < 1) {
      await new Promise((r) => setTimeout(r, this.slotPollMs));
    }
  }

  /**
   * Serve one model's snapshot with bounded concurrency. Returns how many jobs
   * actually ran: 0 means no slot was free and nothing was dispatched, and the
   * pump then waits for a free slot instead of busy-spinning.
   *
   * The worker pool is sized to the *measured* free-slot count at turn start -
   * that is the live admission gate. Each worker is one slot: it dispatches a
   * job, waits for it, and takes the next one when the slot is free again.
   *
   * Session affinity: while sessions have in-flight jobs, the next dispatch
   * prefers a job from one of them. Their KV state is what llama-server's LCP
   * slot selection just filled, so dispatching another session's job first
   * would force an eviction and a full re-prefill of that job's context. When
   * no session is active, plain FIFO applies.
   */
  async #serveTurn(turnId: string): Promise<number> {
    const free = await this.#freeSlotCount();
    if (free === 0) return 0;

    const snapshot = this.#takeTurn(turnId);
    if (snapshot.length === 1 && snapshot[0].exclusive) {
      const job = snapshot[0];
      this.activeJob = job;
      if (job.session) this.hotSessions.set(turnId, job.session);
      this.#announce();
      try {
        job.onStart?.();
        job.resolve(await job.run());
      } catch (error) {
        job.reject(error);
      } finally {
        this.activeJob = null;
        this.#announce();
      }
      return 1;
    }
    if (snapshot.length === 0) return 0;

    const total = snapshot.length;
    const active = new Set<string>();
    const worker = async (): Promise<void> => {
      for (;;) {
        const job = await this.#withClaimLock(() => this.#claimJob(snapshot, active, turnId));
        if (!job) return;
        try {
          job.resolve(await job.run());
        } catch (error) {
          job.reject(error);
        }
        active.delete(job.session ?? "");
      }
    };
    const pool: Promise<void>[] = [];
    for (let i = 0; i < Math.min(free, snapshot.length); i += 1) pool.push(worker());
    await Promise.all(pool);

    // Undispatched jobs go back in snapshot order, so an exclusive boundary is
    // never overtaken by a deferred job.
    if (snapshot.length > 0) {
      this.queue.push(...snapshot);
      this.#announce();
    }
    return total - snapshot.length;
  }

  async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length) {
        // Prefer a model other than the one that just took a turn, so the two
        // sides alternate; fall back to the head of the queue when only one
        // model is waiting (it simply keeps its turn).
        const pick = this.queue.find((j) => j.modelId !== this.lastTurnId) || this.queue[0];
        const turnId = pick.modelId;

        if (this.loadedId !== turnId) {
          try {
            this.logger?.(`switching to ${pick.model.displayName}`);
            await this.loadModel(pick.model);
          } catch (error) {
            // The model would not load - fail exactly its queued jobs and move on.
            for (const job of this.#take((j) => j.modelId === turnId)) job.reject(error);
            continue;
          }
        }

        this.lastTurnId = turnId;
        this.#announce();
        const ran = await this.#serveTurn(turnId);
        if (ran === 0) {
          // Nothing was dispatched: no slot was free. Wait for one instead of
          // busy-spinning; the queue keeps its no-deadline contract - it
          // simply cannot start yet.
          await this.#awaitSlot();
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Queue snapshot for the status endpoint / UI. */
  stats(): SchedulerStats {
    const waiting: Record<string, number> = {};
    const waitingModelIds: Record<string, number> = {};
    for (const job of this.queue) {
      const name = job.model.displayName;
      waiting[name] = (waiting[name] || 0) + 1;
      waitingModelIds[job.modelId] = (waitingModelIds[job.modelId] || 0) + 1;
    }
    const active =
      this.activeJob && this.activeJob.kind !== "completion"
        ? { modelId: this.activeJob.modelId, kind: this.activeJob.kind }
        : null;
    return {
      queued: this.queue.length,
      waiting,
      waitingModelIds,
      lastTurn: this.lastTurnId,
      active,
    };
  }
}
