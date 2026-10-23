import type { Profile } from "../config/schema.js";
import type { Model } from "../types.js";
import type { ModelScheduler, SchedulerStats, SchedulerSubmitOptions } from "./scheduler.js";
import {
  isSchedulerRequestAbandoned,
  Scheduler,
  type SchedulerOperationOptions,
} from "./scheduler.js";
import type { SchedulerSupervisor } from "./scheduler.js";

export interface PoolSupervisor extends SchedulerSupervisor {
  stop(signal?: AbortSignal): Promise<void>;
}

interface PoolSlot<TSupervisor extends PoolSupervisor> {
  index: number;
  supervisor: TSupervisor;
  scheduler: Scheduler<TSupervisor>;
  assignedModelId: string | null;
  pending: number;
  reservationBytes: number;
  lastUsedAt: number;
}

interface PendingJob<TSupervisor extends PoolSupervisor> {
  model: Model;
  run: (supervisor: TSupervisor) => Promise<unknown>;
  options: SchedulerSubmitOptions;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export interface ModelProcessPoolOptions<TSupervisor extends PoolSupervisor> {
  initialSupervisor: TSupervisor;
  maxModels: number;
  createSupervisor: (index: number) => TSupervisor;
  createScheduler: (
    supervisor: TSupervisor,
    loadModel: (model: Model) => Promise<void>,
    onChange: () => void,
  ) => Scheduler<TSupervisor>;
  /** Returns the complete VRAM reservation for the process after it is ready. */
  loadModel: (
    supervisor: TSupervisor,
    model: Model,
    reservedElsewhereBytes: number,
    profile: Profile | undefined,
    signal: AbortSignal,
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
export interface ManagedModelProcess<TSupervisor extends PoolSupervisor = PoolSupervisor> {
  supervisor: TSupervisor;
  start: (profile: Profile) => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Global admission and eviction boundary for independently hosted models.
 *
 * Each resident model owns one TSupervisor/Scheduler pair and therefore one
 * llama-server process, port, KV pool, and lifecycle. Requests for a resident
 * model go directly to that process. An unloaded model claims a free process
 * slot, or evicts the least-recently-used idle process when the configured
 * model limit is full. Busy processes are never evicted; the request remains
 * queued until one becomes idle.
 */
export class ModelProcessPool<
  TSupervisor extends PoolSupervisor,
> implements ModelScheduler<TSupervisor> {
  readonly #createSupervisor: ModelProcessPoolOptions<TSupervisor>["createSupervisor"];
  readonly #createScheduler: ModelProcessPoolOptions<TSupervisor>["createScheduler"];
  readonly #loadModel: ModelProcessPoolOptions<TSupervisor>["loadModel"];
  readonly #onChange: (() => void) | null;
  readonly #logger: ((message: string) => void) | null;
  readonly #slots: PoolSlot<TSupervisor>[] = [];
  readonly #queue: PendingJob<TSupervisor>[] = [];
  #maxModels: number;
  #busy = false;
  #dirty = false;
  #clock = 0;
  #releasing = new Map<PoolSlot<TSupervisor>, Promise<void>>();
  #closed = false;
  #lifetime = new AbortController();
  #stopping: Promise<void> | null = null;
  #loading: Promise<void> = Promise.resolve();
  #maintenance: Promise<void> = Promise.resolve();

  constructor(options: ModelProcessPoolOptions<TSupervisor>) {
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
    run: (supervisor: TSupervisor) => Promise<unknown>,
    options: SchedulerSubmitOptions = {},
  ): Promise<unknown> {
    if (this.#closed) return Promise.reject(new Error("Brain process pool stopped"));
    if (options.signal?.aborted) return Promise.reject(options.signal.reason);
    return new Promise((resolve, reject) => {
      const cleanup = () => options.signal?.removeEventListener("abort", cancel);
      const cancel = () => {
        const index = this.#queue.indexOf(job);
        if (index < 0) return;
        this.#queue.splice(index, 1);
        cleanup();
        reject(options.signal?.reason);
        this.#announce();
        void this.#dispatch();
      };
      const job: PendingJob<TSupervisor> = {
        model,
        run,
        options,
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      };
      this.#queue.push(job);
      options.signal?.addEventListener("abort", cancel, { once: true });
      this.#announce();
      queueMicrotask(() => void this.#dispatch());
    });
  }

  /** Run an exclusive operation with pool-owned model lifecycle controls. */
  submitOperation(
    model: Model,
    run: (process: ManagedModelProcess<TSupervisor>) => Promise<unknown>,
    options: SchedulerOperationOptions,
  ): Promise<unknown> {
    return this.submit(
      model,
      async (supervisor) => {
        const slot = this.#slots.find((candidate) => candidate.supervisor === supervisor);
        if (!slot) throw new Error("The scheduled model process is no longer in the pool.");
        return run({
          supervisor,
          start: async (profile) => {
            await this.#loadSlot(slot, model, profile, options.signal);
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
      { ...options, exclusive: true },
    );
  }

  /** Load a model and leave it resident without consuming an inference slot. */
  async preload(model: Model, signal?: AbortSignal): Promise<void> {
    await this.submit(model, async () => undefined, { signal });
  }

  /** Apply the host-owned process limit and retire excess idle processes. */
  async configure(maxModels: number): Promise<void> {
    this.#maxModels = normalizeModelLimit(maxModels);
    await this.#maintain(() => this.#trimIdleSlots());
    this.#announce();
    void this.#dispatch();
  }

  supervisorFor(modelId: string): TSupervisor | null {
    return this.#slots.find((slot) => slot.assignedModelId === modelId)?.supervisor ?? null;
  }

  supervisors(): TSupervisor[] {
    return this.#slots.map((slot) => slot.supervisor);
  }

  /** Complete statuses for every process that currently owns a model. */
  residentSupervisors(): TSupervisor[] {
    return this.#slots
      .filter((slot) => slot.assignedModelId !== null && slot.supervisor.state !== "stopped")
      .map((slot) => slot.supervisor);
  }

  reservationFor(modelId: string): number {
    return this.#slots.find((slot) => slot.assignedModelId === modelId)?.reservationBytes ?? 0;
  }

  async unload(modelId?: string | null): Promise<void> {
    await this.#maintain(async () => {
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
      return;
    });
    this.#announce();
    void this.#dispatch();
  }

  stop(): Promise<void> {
    if (this.#stopping) return this.#stopping;
    this.#closed = true;
    const error = new Error("Brain process pool stopped");
    this.#lifetime.abort(error);
    for (const job of this.#queue.splice(0)) job.reject(error);
    for (const slot of this.#slots) slot.scheduler.stop(error);
    this.#stopping = Promise.all(this.#slots.map((slot) => slot.supervisor.stop())).then(
      async () => {
        await this.#maintenance;
        await this.#loading;
        for (const slot of this.#slots) {
          slot.assignedModelId = null;
          slot.reservationBytes = 0;
        }
        this.#announce();
        return;
      },
    );
    return this.#stopping;
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

  #makeSlot(index: number, supervisor: TSupervisor): PoolSlot<TSupervisor> {
    const slot: PoolSlot<TSupervisor> = {
      index,
      supervisor,
      scheduler: this.#createScheduler(
        supervisor,
        async (model) => this.#loadSlot(slot, model),
        () => {
          this.#announce();
          void this.#dispatch();
        },
      ),
      assignedModelId: supervisor.model?.id ?? null,
      pending: 0,
      reservationBytes: 0,
      lastUsedAt: ++this.#clock,
    };
    return slot;
  }

  async #loadSlot(
    slot: PoolSlot<TSupervisor>,
    model: Model,
    profile?: Profile,
    signal?: AbortSignal,
  ): Promise<void> {
    // Loading processes must see reservations committed by previous loads.
    const load = this.#loading.then(async () => {
      if (this.#closed) throw new Error("Brain process pool stopped");
      const reservedElsewhereBytes = this.#slots.reduce(
        (total, candidate) => (candidate === slot ? total : total + candidate.reservationBytes),
        0,
      );
      const reservation = await this.#loadModel(
        slot.supervisor,
        model,
        reservedElsewhereBytes,
        profile,
        signal ? AbortSignal.any([signal, this.#lifetime.signal]) : this.#lifetime.signal,
      );
      if (this.#closed) {
        await slot.supervisor.stop();
        throw new Error("Brain process pool stopped");
      }
      slot.reservationBytes = reservation;
      slot.assignedModelId = model.id;
      slot.lastUsedAt = ++this.#clock;
      this.#announce();
      return;
    });
    this.#loading = load.catch(() => undefined);
    return load;
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
    } catch (error) {
      for (const job of this.#queue.splice(0)) job.reject(error);
      this.#announce();
    } finally {
      this.#busy = false;
    }
  }

  async #pass(): Promise<void> {
    if (this.#closed) return;
    await this.#maintain(() => this.#trimIdleSlots());
    for (;;) {
      if (this.#closed) return;
      let dropped = false;
      for (const job of this.#queue.slice()) {
        if (job.options.signal?.aborted || isSchedulerRequestAbandoned(job.options)) {
          dropped = true;
          this.#queue.splice(this.#queue.indexOf(job), 1);
          if (job.options.signal?.aborted) job.reject(job.options.signal.reason);
          else job.resolve(undefined);
        }
      }
      if (dropped) this.#announce();
      let selectedIndex = -1;
      let selectedSlot: PoolSlot<TSupervisor> | null = null;
      for (let index = 0; index < this.#queue.length; index += 1) {
        const candidate = this.#queue[index]!;
        const slot = await this.#slotFor(candidate.model);
        if (this.#closed) return;
        if (!slot || !this.#claimable(slot, candidate)) continue;
        selectedIndex = this.#queue.indexOf(candidate);
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
          if (!this.#closed && slot.supervisor.state === "failed" && slot.pending === 0) {
            void this.#releaseSlot(slot)
              .catch((error) => {
                this.#logger?.(`Brain model cleanup failed: ${String(error)}`);
              })
              .finally(() => void this.#dispatch());
          }
          this.#announce();
          void this.#dispatch();
        });
    }
  }

  #maintain(action: () => Promise<void>): Promise<void> {
    const operation = this.#maintenance.then(action);
    this.#maintenance = operation.catch(() => undefined);
    return operation;
  }

  #claimable(slot: PoolSlot<TSupervisor>, job: PendingJob<TSupervisor>): boolean {
    return (
      this.#queue.includes(job) &&
      this.#slots.includes(slot) &&
      !this.#releasing.has(slot) &&
      slot.assignedModelId === job.model.id
    );
  }

  async #slotFor(model: Model): Promise<PoolSlot<TSupervisor> | null> {
    const resident = this.#slots.find(
      (slot) => slot.assignedModelId === model.id && !this.#releasing.has(slot),
    );
    if (resident) return resident;

    let empty = this.#slots.find(
      (slot) =>
        slot.assignedModelId === null &&
        slot.scheduler.isIdle &&
        slot.pending === 0 &&
        !this.#releasing.has(slot),
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
      .filter((slot) => slot.scheduler.isIdle && slot.pending === 0 && !this.#releasing.has(slot))
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

  #releaseSlot(slot: PoolSlot<TSupervisor>): Promise<void> {
    const releasing = this.#releasing.get(slot);
    if (releasing) return releasing;
    const release = Promise.resolve()
      .then(async () => {
        await slot.supervisor.stop();
        slot.scheduler.forgetSlots();
        slot.assignedModelId = null;
        slot.reservationBytes = 0;
        slot.lastUsedAt = ++this.#clock;
        return;
      })
      .finally(() => {
        this.#releasing.delete(slot);
      });
    this.#releasing.set(slot, release);
    return release;
  }

  async #trimIdleSlots(): Promise<void> {
    if (this.#slots.length <= this.#maxModels) return;
    const removable = this.#slots
      .filter((slot) => slot.scheduler.isIdle && slot.pending === 0 && !this.#releasing.has(slot))
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
