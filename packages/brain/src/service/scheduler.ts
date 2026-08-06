/**
 * Cooperative single-GPU scheduler with per-model concurrency.
 *
 * Only one model is resident at a time. Completion requests are queued rather
 * than refused for "wrong / no model loaded".
 *
 *  - Requests for the resident model run concurrently, up to that model's
 *    `parallelSlots` (the same number of sequence slots llama-server was
 *    launched with - sending more would only queue inside llama-server). Extra
 *    same-model requests wait for a free slot; they never trigger a load.
 *  - Requests for a *different* model wait for a model switch. When the resident
 *    model's current batch drains, the scheduler switches and serves the other
 *    model's batch - so two clients wanting different models share the GPU by
 *    taking turns.
 *
 * Fairness: after a model finishes a turn, the next turn prefers a *different*
 * model when one is waiting, so a steady stream for model A cannot starve model
 * B. A turn is a snapshot: requests that arrive for a model mid-turn wait for
 * its next turn.
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
}

/** A queued completion request bound to a resolved catalog model. */
export interface QueuedJob {
  modelId: string;
  model: Model;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export interface SchedulerStats {
  queued: number;
  waiting: Record<string, number>;
  lastTurn: string | null;
}

export class Scheduler {
  supervisor: SchedulerSupervisor;
  loadModel: (model: Model) => Promise<void>; // async (model) => resolves once it is ready
  logger: ((message: string) => void) | null; // optional (message: string) => void
  queue: QueuedJob[]; // { modelId, model, run, resolve, reject }
  lastTurnId: string | null;
  pumping: boolean;
  onChange: (() => void) | null;

  constructor({ supervisor, loadModel, logger = null, onChange = null }: SchedulerOptions) {
    this.supervisor = supervisor;
    this.loadModel = loadModel; // async (model) => resolves once it is ready
    this.logger = logger; // optional (message: string) => void
    this.queue = []; // { modelId, model, run, resolve, reject }
    this.lastTurnId = null;
    this.pumping = false;
    this.onChange = onChange;
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

  /** How many requests may run at once against the resident model. */
  get concurrency(): number {
    return Math.max(1, Math.min(MAX_CONCURRENCY, this.supervisor.profile?.parallelSlots || 1));
  }

  /**
   * Queue a job for an already-resolved catalog model. `run` is invoked once
   * that model is the resident one; the returned promise settles when run does.
   * Pumping is deferred a microtask so a burst of requests submitted together
   * share one turn rather than the first one snapshotting a turn by itself.
   */
  submit(model: Model, run: () => Promise<unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.queue.push({ modelId: model.id, model, run, resolve, reject });
      this.#announce();
      queueMicrotask(() => this.pump());
    });
  }

  #take(pred: (job: QueuedJob) => boolean): QueuedJob[] {
    const kept: QueuedJob[] = [];
    const taken: QueuedJob[] = [];
    for (const job of this.queue) (pred(job) ? taken : kept).push(job);
    this.queue = kept;
    if (taken.length > 0) this.#announce();
    return taken;
  }

  /** Serve one model's snapshot with bounded concurrency. */
  async #serveTurn(turnId: string): Promise<void> {
    const jobs = this.#take((j) => j.modelId === turnId);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < jobs.length) {
        const job = jobs[next];
        next += 1;
        try {
          job.resolve(await job.run());
        } catch (error) {
          job.reject(error);
        }
      }
    };
    const pool: Promise<void>[] = [];
    for (let i = 0; i < Math.min(this.concurrency, jobs.length); i += 1) pool.push(worker());
    await Promise.all(pool);
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
        await this.#serveTurn(turnId);
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Queue snapshot for the status endpoint / UI. */
  stats(): SchedulerStats {
    const waiting: Record<string, number> = {};
    for (const job of this.queue) {
      const name = job.model.displayName;
      waiting[name] = (waiting[name] || 0) + 1;
    }
    return { queued: this.queue.length, waiting, lastTurn: this.lastTurnId };
  }
}
