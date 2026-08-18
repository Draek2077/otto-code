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
 * The variables it arbitrates, in the order it applies them:
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
 *  6. OWNERSHIP. A slot's KV belongs to the chat that last ran on it.
 *     llama-server never clears a released slot's prompt, so a slot handed to a
 *     different chat would still hold the previous chat's KV - and that is
 *     exactly the cross-chat bleed users see in thinking blocks. The scheduler
 *     therefore tracks `slotId -> session` for every slot it names (the
 *     `prompt_cache_key` that owned it, or `null` for keyless jobs) and erases
 *     the slot before handoff to a different owner. Same session reusing its
 *     own slot keeps its KV (that is the cache the whole point of `--cache-ram`
 *     is to protect). The eraser is injected, because the engine endpoint is a
 *     transport detail the scheduler stays agnostic of. The map is wiped when
 *     the engine reloads a model: slot ids do not survive a switch, and a
 *     fresh engine has no stale KV.
 *
 *     The erase is awaited BEFORE the job's run() reaches the engine: the
 *     engine runs tasks in arrival order, so the erase must land in its queue
 *     ahead of the completion that follows. Firing the erase and the
 *     completion back-to-back as independent requests would let the engine see
 *     the completion first, run it on the dirty slot, and only then erase the
 *     KV the completion just produced - the fix inverting into the bug.
 *
 * The scheduler is transport-agnostic: a job is a resolved catalog model plus a
 * `run()` that does the proxying, which keeps the logic unit-testable.
 */
import type { Model } from "../types.js";
import type { Profile } from "../config/schema.js";

const MAX_CONCURRENCY = 16;

/** A short, safe description of an unknown error value for log lines. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The subset of the supervisor the scheduler observes to size and route turns. */
export interface SchedulerSupervisor {
  state: string;
  model: Model | null;
  profile: Profile | null;
}

/**
 * The answer to a live slot measurement: how many sequence slots are free, and
 * optionally WHICH ones. `idle` drives admission (see CAPACITY); `ids` lets
 * `#pass` hand a distinct slot id to each job it admits, so the router can pin
 * a completion to the exact slot this sample saw free. `ids` is absent when the
 * engine reports a count but no per-slot rows - then admission still works, but
 * no honest pin can be named and the affected requests run unpinned.
 */
export interface SlotMeasurement {
  idle: number;
  ids?: number[];
}

/**
 * Erase one engine slot's retained KV state before the next task may land on
 * it. This is the fix for the cross-chat KV bleed (see OWNERSHIP below):
 * llama.cpp never clears a slot's prompt on release, so a slot that served one
 * chat hands that chat's KV to whoever is pinned to the slot next. The caller
 * (the router) performs the engine-side erase; the scheduler only decides WHEN
 * a handoff happens and reports it, because only it knows which session was
 * admitted to which slot.
 *
 * The promise resolves (never rejects) once the engine has ACKNOWLEDGED the
 * erase. That acknowledgment matters: the engine runs tasks in arrival order,
 * so the erase must sit in its queue ahead of the completion the scheduler is
 * about to post. The scheduler awaits the promise before `run()` reaches the
 * engine, which is what keeps the order honest across the HTTP boundary.
 *
 * Must never throw or reject: an erase failure degrades to the old (bleedy)
 * behavior but must never fail the completion that is about to run.
 */
export type SlotEraser = (slotId: number) => Promise<void>;

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
   *
   * May also answer with the free slots NAMED, not just counted:
   * `{ idle, ids }` (the engine's idle slot ids from `/slots`). The count is
   * what admission needs; the ids are what `onSlotFree` hands to admitted
   * completions so the router can pin each one to the slot this very sample
   * saw free. A plain number still works - it just yields no pin data.
   */
  freeSlots?:
    | (() => Promise<SlotMeasurement | number | null> | SlotMeasurement | number | null)
    | null;
  /**
   * How long to wait before re-checking the engine when capacity is zero and
   * no job of ours is running - the only state where nothing else will wake
   * the dispatcher.
   */
  slotPollMs?: number;
  /**
   * Erase an engine slot's KV before it is handed to a different chat (see
   * OWNERSHIP). Injected rather than built in: the engine endpoint is a
   * transport detail, and its availability is runtime-dependent (the
   * llama-server build must support `POST /slots?action=erase` - it does not
   * on a server launched without `--slot-save-path`). Absent (null) means
   * ownership is tracked and reported but nothing is erased - the old
   * behavior, for runtimes where the engine cannot wipe a slot.
   */
  eraseSlot?: SlotEraser | null;
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
  /**
   * Called exactly once, when this job is admitted to a slot - i.e. the moment
   * the scheduler's own free-slot measurement just counted it. The argument is
   * the engine slot id the job may pin to, or null when no slot can be named
   * honestly (sample failed, engine reports no per-slot rows, or the engine's
   * slot pool is fully busy).
   *
   * Why the scheduler, not the job, names the slot: a job that samples `/slots`
   * itself at dispatch time can race another job admitted in the same pass -
   * neither has reached the engine yet, so both see the same slot free and both
   * pin it, and the engine's busy-pinned-slot deferral turns the pair back into
   * a serial queue. The pin must be drawn from the very measurement that
   * admitted the job, one distinct id per job, so the ids it hands out are
   * exactly the slots the engine still has free at the moment of admission.
   *
   * Exclusive operations are never called: they run alone on a drained engine
   * and their attribution is not per-slot.
   */
  onSlotFree?: ((slotId: number | null) => void) | null;
}

/** A queued request or host operation bound to a resolved catalog model. */
export interface QueuedJob {
  modelId: string;
  model: Model;
  kind: SchedulerJobKind;
  exclusive: boolean;
  session: string | null;
  onStart: (() => void) | null;
  onSlotFree: ((slotId: number | null) => void) | null;
  /**
   * The engine slot this job was pinned to at admission, or null when none was
   * named. Kept on the job so a later pass can exclude it from the ids it hands
   * out: a job admitted moments ago may not have reached llama-server yet, so
   * the next `/slots` sample can still report its slot idle and offer it to a
   * second job. Both would then pin the same slot, and the engine's defer-when-
   * busy behavior would serialize the pair onto it while another slot sat empty.
   */
  slotId: number | null;
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
  eraseSlot: SlotEraser | null;
  /**
   * Engine slot -> the session that last ran on it (see OWNERSHIP). The value
   * is null for keyless jobs: a keyless job cannot prove ownership of anything
   * after it settles, so the next keyed chat landing on that slot is treated as
   * a handoff and the slot is erased for it. Wiped wholesale whenever the
   * engine reloads a model - slot ids do not survive the relaunch.
   */
  slotOwners = new Map<number, string | null>();

  /** Claimed by the current turn, waiting for a slot. Empty between turns. */
  #batch: QueuedJob[] = [];
  /** Started, not yet settled. Invariant: every member's model is `#turnId`. */
  #running = new Set<QueuedJob>();
  /** The model that owns the engine for this turn, or null between turns. */
  #turnId: string | null = null;
  /**
   * Distinct engine slot ids, one per job this pass may still admit, drawn from
   * the pass's own free-slot sample (`null` when the engine reported no
   * per-slot rows - then nothing is pinned). A job pops one as it is admitted
   * in `#start`, so two jobs admitted in the same pass can never be named the
   * same slot - the failure mode a job-side sample at dispatch time would
   * produce. Reset whenever the engine is relaunched, because slot ids do not
   * survive a model switch.
   */
  #freeSlotIds: number[] | null = null;
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
    eraseSlot = null,
  }: SchedulerOptions) {
    this.supervisor = supervisor;
    this.loadModel = loadModel; // async (model) => resolves once it is ready
    this.logger = logger; // optional (message: string) => void
    this.onChange = onChange;
    this.freeSlots = freeSlots;
    this.slotPollMs = slotPollMs;
    this.eraseSlot = eraseSlot;
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
      onSlotFree = null,
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
        onSlotFree,
        slotId: null,
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
   * "wait forever". Also carries the free slot ids when the engine reports
   * them, so `#pass` can pin each admitted job to a distinct one.
   */
  async #sampleFreeSlots(): Promise<SlotMeasurement | null> {
    if (!this.freeSlots) return null;
    try {
      const free = await this.freeSlots();
      if (free === null || free === undefined || (typeof free === "number" && Number.isNaN(free)))
        return null;
      if (typeof free === "number") return { idle: Math.max(0, free) };
      return {
        idle: Math.max(0, free.idle),
        ...(Array.isArray(free.ids) && free.ids.length > 0 ? { ids: free.ids } : {}),
      };
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
   * Start a job and wire its completion back into the dispatcher. The settle
   * callback is what asks for the next decision. `await`ed by the pass: a
   * handoff erase must reach the engine's task queue BEFORE this job's
   * completion is posted (see OWNERSHIP), so the pass yields for the erase.
   */
  async #start(job: QueuedJob): Promise<void> {
    this.#running.add(job);
    if (job.exclusive) this.activeJob = job;
    // Name the slot this job is admitted to, from this pass's own sample,
    // before `run()` is invoked. One id per job, never reused: two jobs
    // admitted in the same pass must never be pinned to the same slot.
    if (!job.exclusive && job.onSlotFree) {
      const slotId = this.#freeSlotIds ? (this.#freeSlotIds.shift() ?? null) : null;
      job.slotId = slotId;
      // OWNERSHIP: the slot now belongs to this job's session. A job may only
      // reuse a slot's KV when it is the same session that last ran there -
      // llama-server keeps a released slot's prompt, so a different session
      // would inherit the previous chat's KV (the cross-chat bleed). Erase the
      // slot - and WAIT for the engine to acknowledge it - before the job's
      // run() reaches the engine, so the handoff lands in the engine's task
      // queue ahead of this completion. Same-session reuse keeps the KV: that
      // is the cache --cache-ram exists to protect, and settling never erases.
      if (slotId !== null) {
        // A slot with NO entry is fresh (just launched, or just relaunched):
        // it holds nothing, so nothing may be erased for it - the first chat
        // to land there is the one the KV is being paid for. A slot WITH an
        // entry holds that session's KV (or a keyless client's, recorded as
        // null): handing it to a DIFFERENT session would inherit that KV, so
        // the erase is owed. The entry's mere existence is the distinction -
        // `get() ?? null` collapses it and erases fresh slots.
        const hasPrevious = this.slotOwners.has(slotId);
        const previous = this.slotOwners.get(slotId) ?? null;
        if (hasPrevious && previous !== job.session) {
          await this.#eraseFor(slotId, previous, job.session);
        }
        this.slotOwners.set(slotId, job.session);
      }
      try {
        job.onSlotFree(slotId);
      } catch {
        // Slot attribution must never fail the job it belongs to.
      }
    }
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
        // OWNERSHIP: settling does NOT erase and does NOT clear the owner entry.
        // The engine keeps a released slot's KV indefinitely (nothing in our
        // configuration clears or parks it - see OWNERSHIP in the header), and
        // that is exactly what this job's session wants back on its next turn:
        // the chat's KV, paid for once, reused on every following request.
        // Erasing here would hand the same chat its own re-prefill cost, and a
        // DIFFERENT chat is protected the moment it is admitted, when the
        // owner mismatch is known for sure. So the slot keeps its KV and its
        // owner until the next admission - whoever that is - decides otherwise.
        this.#announce();
        void this.#dispatch();
      }
    })();
  }

  /**
   * Erase one slot's KV before it is handed to a different owner (see
   * OWNERSHIP). `from` is the session whose KV the slot currently holds
   * (null for a keyless previous owner), `to` is the session about to run on
   * it. Resolves once the engine acknowledges the erase, so the caller can
   * post the new completion only after the clean state is guaranteed to sit
   * in the engine's task queue first. Never throws or rejects: a failure
   * degrades to the old (bleedy) behavior but must not fail the completion it
   * protects.
   */
  async #eraseFor(slotId: number, from: string | null, to: string | null): Promise<void> {
    if (!this.eraseSlot) return;
    try {
      this.logger?.(`erasing slot ${slotId} before handoff${from ? ` from ${from}` : ""} to ${to}`);
      await this.eraseSlot(slotId);
    } catch (error) {
      this.logger?.(`slot ${slotId} erase failed: ${describeError(error)}`);
    }
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
   * Drop every recorded slot owner. The engine's slots do not survive a model
   * (re)launch, so their owners do not either - a stale entry would make the
   * next admission think a FRESH slot still holds a previous chat's KV and
   * erase it (an unnecessary re-prefill), or, worse, let a keyless job be
   * mistaken for the owner of a slot it is not.
   *
   * Called from two places: `#pass` clears the owners the moment a turn begins
   * on a different model than the one it last served (a model switch, where
   * the scheduler itself sees the relaunch), and the router calls it on the
   * supervisor's `starting` state - the relaunch that keeps the SAME model
   * resident (a live profile edit), where the turn never changes and only the
   * supervisor says the slots are gone. Both paths are idempotent.
   */
  forgetSlots(): void {
    this.slotOwners.clear();
  }

  /** The relaunch reset: owners and the in-flight pin list are both slot-scoped. */
  #resetSlots(): void {
    this.forgetSlots();
    this.#freeSlotIds = null;
  }

  /**
   * One decision pass: start as many jobs as residency, exclusivity, the turn
   * boundary and capacity allow, then return. Each iteration re-derives
   * everything, so there is no state to keep consistent between them.
   */
  async #pass(): Promise<void> {
    // The engine's idle count, sampled at most once per pass, plus how many
    // jobs this pass has started against it (the sample cannot see those yet).
    let measured: SlotMeasurement | null = null;
    let sampled = false;
    let startedHere = 0;
    // Distinct slot ids this pass may pin, one per admitted job. Refilled from
    // the sample the first time capacity is checked; consumed in `#start`.
    this.#freeSlotIds = null;

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
          // A relaunched engine has all its slots back; the old sample is void,
          // and slot ids do not survive the relaunch, so the owners that named
          // them are void too - a stale entry would make the next admission
          // erase a FRESH slot (an unnecessary re-prefill) or mistake a keyless
          // job for its owner.
          sampled = false;
          startedHere = 0;
          this.#resetSlots();
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

      // 3. An exclusive operation runs alone, on a drained engine. (Awaited:
      // `#start` may pause on a handoff erase, and the pass must not read or
      // mutate the state a started job depends on while it is in flight.)
      if (this.#batch.length === 1 && this.#batch[0].exclusive) {
        if (this.#running.size > 0) return;
        await this.#start(this.#batch.shift()!);
        return;
      }

      // 4. Capacity. The ceiling is the KV pool we own; the measurement is
      //    there to notice slots taken by traffic we did not schedule. They
      //    are combined, never both subtracted - see CAPACITY in the header.
      if (!sampled) {
        measured = await this.#sampleFreeSlots();
        sampled = true;
        // Drop any id a running job already holds. That job may have been
        // admitted only moments ago and not yet reached the engine, so this
        // sample can still see its slot idle; handing the same id out twice
        // would pin two requests to one slot (see `QueuedJob.slotId`).
        const held = new Set<number>();
        for (const job of this.#running) if (job.slotId !== null) held.add(job.slotId);
        const ids = measured?.ids?.filter((id) => !held.has(id)) ?? null;
        this.#freeSlotIds = ids && ids.length > 0 ? ids : null;
      }
      const room = Math.min(
        this.concurrency - this.#running.size,
        measured === null ? Number.POSITIVE_INFINITY : measured.idle - startedHere,
      );
      if (room < 1) {
        if (this.#running.size === 0) this.#pollForSlot();
        return;
      }

      // 5. Start the next job. Affinity decides which of the batch goes first.
      const job = this.#claimJob(turnId);
      if (!job) return;
      startedHere += 1;
      await this.#start(job);
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
