import type { Profile } from "../config/schema.js";
import type { Model } from "../types.js";
import type { ModelScheduler, SchedulerStats, SchedulerSubmitOptions } from "./scheduler.js";
import { Scheduler } from "./scheduler.js";
import type { Supervisor } from "./supervisor.js";

interface PoolSlot {
  index: number;
  supervisor: Supervisor;
  scheduler: Scheduler<Supervisor>;
  assignedModelId: string | null;
  pending: number;
  reservationBytes: number;
  lastUsedAt: number;
}

interface PendingJob {
  model: Model;
  run: (supervisor: Supervisor) => Promise<unknown>;
  options: SchedulerSubmitOptions;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export interface ModelProcessPoolOptions {
  initialSupervisor: Supervisor;
  maxModels: number;
  createSupervisor: (index: number) => Supervisor;
  createScheduler: (
    supervisor: Supervisor,
    loadModel: (model: Model) => Promise<void>,
    onChange: () => void,
  ) => Scheduler<Supervisor>;
  /** Returns the complete VRAM reservation for the process after it is ready. */
  loadModel: (
    supervisor: Supervisor,
    model: Model,
    reservedElsewhereBytes: number,
    profile?: Profile,
  ) => Promise<number>;
  onChange?: (() => void) | null;
  logger?: ((message: string) => void) | null;
}

/**
 * The only lifecycle surface exposed to a resident host operation.
 *
 * Calibration and sweep need to relaunch their target with temporary profiles.
 * Keeping those launches on the pool-owned lease means process limits, VRAM
 * reservations, eviction state, scheduler slot ownership, and status updates
 * all observe the same lifecycle.
 */
export interface ManagedModelProcess {
  supervisor: Supervisor;
  start: (profile: Profile) => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Global admission and eviction boundary for independently hosted models.
 *
 * Each resident model owns one Supervisor/Scheduler pair and therefore one
 * llama-server process, port, KV pool, and lifecycle. Requests for a resident
 * model go directly to that process. An unloaded model claims a free process
 * slot, or evicts the least-recently-used idle process when the configured
 * model limit is full. Busy processes are never evicted; the request remains
 * queued until one becomes idle.
 */
export class ModelProcessPool implements ModelScheduler<Supervisor> {
  readonly #createSupervisor: ModelProcessPoolOptions["createSupervisor"];
  readonly #createScheduler: ModelProcessPoolOptions["createScheduler"];
  readonly #loadModel: ModelProcessPoolOptions["loadModel"];
  readonly #onChange: (() => void) | null;
  readonly #logger: ((message: string) => void) | null;
  readonly #slots: PoolSlot[] = [];
  readonly #queue: PendingJob[] = [];
  #maxModels: number;
  #busy = false;
  #dirty = false;
  #clock = 0;

  constructor(options: ModelProcessPoolOptions) {
    this.#createSupervisor = options.createSupervisor;
    this.#createScheduler = options.createScheduler;
    this.#loadModel = options.loadModel;
    this.#onChange = options.onChange ?? null;
    this.#logger = options.logger ?? null;
    this.#maxModels = normalizeModelLimit(options.maxModels);
    this.#slots.push(this.#makeSlot(0, options.initialSupervisor));
  }

  get maxModels(): number {
    return this.#maxModels;
  }

  submit(
    model: Model,
    run: (supervisor: Supervisor) => Promise<unknown>,
    options: SchedulerSubmitOptions = {},
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.#queue.push({ model, run, options, resolve, reject });
      this.#announce();
      queueMicrotask(() => void this.#dispatch());
    });
  }

  /** Run an exclusive operation with pool-owned model lifecycle controls. */
  submitOperation(
    model: Model,
    run: (process: ManagedModelProcess) => Promise<unknown>,
    options: SchedulerSubmitOptions,
  ): Promise<unknown> {
    return this.submit(
      model,
      async (supervisor) => {
        const slot = this.#slots.find((candidate) => candidate.supervisor === supervisor);
        if (!slot) throw new Error("The scheduled model process is no longer in the pool.");
        return run({
          supervisor,
          start: async (profile) => {
            await this.#loadSlot(slot, model, profile);
          },
          stop: async () => {
            await supervisor.stop();
            slot.scheduler.forgetSlots();
            slot.reservationBytes = 0;
            slot.lastUsedAt = ++this.#clock;
            this.#announce();
          },
        });
      },
      options,
    );
  }

  /** Load a model and leave it resident without consuming an inference slot. */
  async preload(model: Model): Promise<void> {
    await this.submit(model, async () => undefined);
  }

  /** Apply the host-owned process limit and retire excess idle processes. */
  async configure(maxModels: number): Promise<void> {
    this.#maxModels = normalizeModelLimit(maxModels);
    await this.#trimIdleSlots();
    this.#announce();
    void this.#dispatch();
  }

  supervisorFor(modelId: string): Supervisor | null {
    return (
      this.#slots.find(
        (slot) =>
          slot.assignedModelId === modelId ||
          (slot.supervisor.model?.id === modelId && slot.supervisor.state !== "stopped"),
      )?.supervisor ?? null
    );
  }

  supervisors(): Supervisor[] {
    return this.#slots.map((slot) => slot.supervisor);
  }

  /** Complete statuses for every process that currently owns a model. */
  residentSupervisors(): Supervisor[] {
    return this.#slots
      .filter((slot) => slot.assignedModelId !== null && slot.supervisor.state !== "stopped")
      .map((slot) => slot.supervisor);
  }

  reservationFor(modelId: string): number {
    return this.#slots.find((slot) => slot.assignedModelId === modelId)?.reservationBytes ?? 0;
  }

  async unload(modelId?: string | null): Promise<void> {
    const targets = modelId
      ? this.#slots.filter((slot) => slot.assignedModelId === modelId)
      : [...this.#slots];
    for (const slot of targets) {
      if (!slot.scheduler.isIdle || slot.pending > 0) {
        throw new Error(
          modelId ? "the model is still serving requests" : "a model is still serving requests",
        );
      }
    }
    await Promise.all(targets.map((slot) => this.#releaseSlot(slot)));
    await this.#trimIdleSlots();
    this.#announce();
    void this.#dispatch();
  }

  async stop(): Promise<void> {
    const error = new Error("Brain process pool stopped");
    for (const job of this.#queue.splice(0)) job.reject(error);
    await Promise.all(this.#slots.map((slot) => slot.supervisor.stop()));
    this.#announce();
  }

  forgetSlots(): void {
    for (const slot of this.#slots) slot.scheduler.forgetSlots();
  }

  stats(): SchedulerStats {
    const waiting: Record<string, number> = {};
    const waitingModelIds: Record<string, number> = {};
    let queued = 0;
    let lastTurn: string | null = null;
    let active: SchedulerStats["active"] = null;

    for (const job of this.#queue) {
      queued += 1;
      waiting[job.model.displayName] = (waiting[job.model.displayName] ?? 0) + 1;
      waitingModelIds[job.model.id] = (waitingModelIds[job.model.id] ?? 0) + 1;
    }
    for (const slot of this.#slots) {
      const stats = slot.scheduler.stats();
      queued += stats.queued;
      for (const [name, count] of Object.entries(stats.waiting)) {
        waiting[name] = (waiting[name] ?? 0) + count;
      }
      for (const [id, count] of Object.entries(stats.waitingModelIds)) {
        waitingModelIds[id] = (waitingModelIds[id] ?? 0) + count;
      }
      lastTurn = stats.lastTurn ?? lastTurn;
      active = active ?? stats.active;
    }
    return { queued, waiting, waitingModelIds, lastTurn, active };
  }

  #makeSlot(index: number, supervisor: Supervisor): PoolSlot {
    const slot = {
      index,
      supervisor,
      scheduler: null as unknown as Scheduler<Supervisor>,
      assignedModelId: supervisor.model?.id ?? null,
      pending: 0,
      reservationBytes: 0,
      lastUsedAt: ++this.#clock,
    };
    slot.scheduler = this.#createScheduler(
      supervisor,
      async (model) => this.#loadSlot(slot, model),
      () => {
        this.#announce();
        void this.#dispatch();
      },
    );
    return slot;
  }

  async #loadSlot(slot: PoolSlot, model: Model, profile?: Profile): Promise<void> {
    const reservedElsewhereBytes = this.#slots.reduce(
      (total, candidate) => (candidate === slot ? total : total + candidate.reservationBytes),
      0,
    );
    slot.reservationBytes = await this.#loadModel(
      slot.supervisor,
      model,
      reservedElsewhereBytes,
      profile,
    );
    slot.assignedModelId = model.id;
    slot.lastUsedAt = ++this.#clock;
    this.#announce();
  }

  #announce(): void {
    try {
      this.#onChange?.();
    } catch {
      // Status observers are not allowed to fail admission or eviction.
    }
  }

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

  async #pass(): Promise<void> {
    await this.#trimIdleSlots();
    for (;;) {
      let selectedIndex = -1;
      let selectedSlot: PoolSlot | null = null;
      for (let index = 0; index < this.#queue.length; index += 1) {
        const candidate = this.#queue[index]!;
        const slot = await this.#slotFor(candidate.model);
        if (!slot) continue;
        selectedIndex = index;
        selectedSlot = slot;
        break;
      }
      if (selectedIndex < 0 || !selectedSlot) return;
      const [job] = this.#queue.splice(selectedIndex, 1);
      if (!job) return;
      const slot = selectedSlot;
      slot.pending += 1;
      slot.lastUsedAt = ++this.#clock;
      this.#announce();
      void slot.scheduler
        .submit(job.model, job.run, job.options)
        .then(job.resolve, job.reject)
        .finally(() => {
          slot.pending = Math.max(0, slot.pending - 1);
          slot.lastUsedAt = ++this.#clock;
          if (slot.supervisor.state === "failed" && slot.pending === 0) {
            void this.#releaseSlot(slot).finally(() => void this.#dispatch());
          }
          this.#announce();
          void this.#dispatch();
        });
    }
  }

  async #slotFor(model: Model): Promise<PoolSlot | null> {
    const resident = this.#slots.find((slot) => slot.assignedModelId === model.id);
    if (resident) return resident;

    let empty = this.#slots.find(
      (slot) => slot.assignedModelId === null && slot.scheduler.isIdle && slot.pending === 0,
    );
    if (!empty && this.#slots.length < this.#maxModels) {
      const index = this.#nextSlotIndex();
      empty = this.#makeSlot(index, this.#createSupervisor(index));
      this.#slots.push(empty);
    }
    if (empty) {
      empty.assignedModelId = model.id;
      return empty;
    }

    const evictable = this.#slots
      .filter((slot) => slot.scheduler.isIdle && slot.pending === 0)
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt)[0];
    if (!evictable) return null;
    this.#logger?.(
      `evicting ${evictable.supervisor.model?.displayName ?? "idle model"} for ${model.displayName}`,
    );
    await this.#releaseSlot(evictable);
    evictable.assignedModelId = model.id;
    return evictable;
  }

  #nextSlotIndex(): number {
    const used = new Set(this.#slots.map((slot) => slot.index));
    let index = 0;
    while (used.has(index)) index += 1;
    return index;
  }

  async #releaseSlot(slot: PoolSlot): Promise<void> {
    await slot.supervisor.stop();
    slot.scheduler.forgetSlots();
    slot.assignedModelId = null;
    slot.reservationBytes = 0;
    slot.lastUsedAt = ++this.#clock;
  }

  async #trimIdleSlots(): Promise<void> {
    if (this.#slots.length <= this.#maxModels) return;
    const removable = this.#slots
      .filter((slot) => slot.scheduler.isIdle && slot.pending === 0)
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt);
    while (this.#slots.length > this.#maxModels && removable.length > 0) {
      const slot = removable.shift()!;
      await this.#releaseSlot(slot);
      const index = this.#slots.indexOf(slot);
      if (index >= 0) this.#slots.splice(index, 1);
    }
  }
}

export function normalizeModelLimit(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(16, Math.floor(value)));
}
