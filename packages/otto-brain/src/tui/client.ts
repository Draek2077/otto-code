/** One demand-owned terminal view of an existing host, independent of its model lifetime. */
import { setTimeout as delay } from "node:timers/promises";
import type { BrainStatusStore } from "../client/status-store.js";
import type { BrainHostResources } from "../service/resource-reader.js";
import { applyTuiLive, type BrainTuiLive } from "./live.js";
import { decodeTuiResult, type BrainTuiExecution } from "./actions.js";
import {
  TuiActionError,
  type BrainTuiAction,
  type BrainTuiActions,
  type BrainTuiActionType,
  type BrainTuiHost,
  type BrainTuiResult,
  type BrainTuiSnapshot,
  type TuiJob,
} from "./host.js";

export interface BrainTuiClientPorts {
  status: BrainStatusStore<BrainTuiLive>;
  readSnapshot(signal: AbortSignal): Promise<BrainTuiSnapshot>;
  readResources(signal: AbortSignal): Promise<BrainHostResources>;
  readJobs(signal: AbortSignal): Promise<TuiJob[]>;
  execute(
    action: BrainTuiAction,
    instanceId: string,
    signal: AbortSignal,
  ): Promise<BrainTuiExecution>;
  endpoint: string | null;
}
export class BrainTuiClient implements BrainTuiHost {
  private snapshot: BrainTuiSnapshot;
  private metadata: BrainTuiSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly lifetime = new AbortController();
  private authority = 0;
  private demands = 0;
  private releaseFeed: (() => void) | null = null;
  private unsubscribeFeed: (() => void) | null = null;
  private hardware: AbortController | null = null;
  private metadataRead: Promise<void> | null = null;
  private metadataAgain = false;
  private jobsRead: Promise<void> | null = null;
  private jobsAgain = false;
  private closed = false;
  constructor(
    initial: BrainTuiSnapshot,
    private readonly ports: BrainTuiClientPorts,
  ) {
    this.metadata = initial;
    this.snapshot = { ...initial, endpoint: ports.endpoint };
  }
  getSnapshot = (): BrainTuiSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(snapshot: BrainTuiSnapshot): void {
    if (this.closed) return;
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
  retainStatus(): () => void {
    if (this.closed) throw new Error("The terminal host is closed");
    if (++this.demands === 1) {
      this.unsubscribeFeed = this.ports.status.subscribe(() => this.receiveFeed());
      this.releaseFeed = this.ports.status.retain();
      this.hardware = new AbortController();
      void this.sampleHardware(this.hardware.signal);
      this.receiveFeed();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.demands === 0) this.releaseDemand();
    };
  }
  private releaseDemand(): void {
    this.hardware?.abort();
    this.hardware = null;
    this.releaseFeed?.();
    this.releaseFeed = null;
    this.unsubscribeFeed?.();
    this.unsubscribeFeed = null;
  }
  private receiveFeed(): void {
    const feed = this.ports.status.getSnapshot();
    const status = feed.status;
    if (feed.connection !== "connected" || !status) {
      this.publish({
        ...this.snapshot,
        connection: feed.connection,
        availableActions: [],
        message: feed.error,
      });
      return;
    }
    if (status.instanceId !== this.metadata.instanceId) {
      if (status.instanceId !== this.snapshot.instanceId) {
        this.authority++;
        this.publish({
          ...applyTuiLive(
            {
              ...this.snapshot,
              models: [],
              availableActions: [],
              logs: [],
              jobs: [],
              runtime: null,
              gpu: null,
              system: null,
              catalog: [],
              runtimes: [],
              storage: null,
              rankings: [],
              benchmarks: [],
            },
            status,
          ),
          connection: "connecting",
          message: "Reading the restarted Brain owner's library...",
        });
      }
      void this.refreshMetadata().catch(() => this.readFailed());
    } else {
      this.publish({
        ...applyTuiLive(this.snapshot, status),
        // The owner projects request-specific permissions in metadata. The SSE
        // writable flag describes Remote policy, not authenticated loopback access.
        availableActions: this.metadata.availableActions,
        logs: feed.logs.map((row) => row.line),
      });
      if (status.libraryRevision !== this.metadata.libraryRevision)
        void this.refreshMetadata().catch(() => this.readFailed());
    }
    if (status.jobRevision !== this.snapshot.jobRevision)
      void this.refreshJobs().catch(() => this.readFailed());
  }
  private readFailed(): void {
    if (this.lifetime.signal.aborted) return;
    this.publish({
      ...this.snapshot,
      message: "Brain data could not refresh. Press r to read it again.",
    });
  }
  private refreshMetadata(): Promise<void> {
    if (this.metadataRead) {
      this.metadataAgain = true;
      return this.metadataRead;
    }
    const read = async () => {
      do {
        this.metadataAgain = false;
        const authority = this.authority;
        const next = await this.ports.readSnapshot(this.lifetime.signal);
        if (this.closed) return;
        if (authority !== this.authority) {
          this.metadataAgain = true;
          continue;
        }
        this.metadata = next;
        const feed = this.ports.status.getSnapshot();
        const snapshot = {
          ...next,
          endpoint: this.ports.endpoint,
          logs: feed.logs.map((row) => row.line),
        };
        this.publish(
          feed.status?.instanceId === next.instanceId
            ? applyTuiLive(snapshot, feed.status)
            : snapshot,
        );
      } while (this.metadataAgain && !this.closed);
    };
    this.metadataRead = read().finally(() => {
      this.metadataRead = null;
    });
    return this.metadataRead;
  }
  private refreshJobs(): Promise<void> {
    if (this.jobsRead) {
      this.jobsAgain = true;
      return this.jobsRead;
    }
    const read = async () => {
      do {
        this.jobsAgain = false;
        const instanceId = this.snapshot.instanceId;
        const revision =
          this.ports.status.getSnapshot().status?.jobRevision ?? this.snapshot.jobRevision;
        const jobs = await this.ports.readJobs(this.lifetime.signal);
        if (this.closed || instanceId !== this.snapshot.instanceId) return;
        this.publish({ ...this.snapshot, jobs, jobRevision: revision });
      } while (this.jobsAgain && !this.closed);
    };
    this.jobsRead = read().finally(() => {
      this.jobsRead = null;
    });
    return this.jobsRead;
  }
  private async sampleHardware(signal: AbortSignal): Promise<void> {
    try {
      while (!signal.aborted) {
        await delay(2000, undefined, { signal, ref: false });
        if (this.snapshot.connection !== "connected") continue;
        const instanceId = this.snapshot.instanceId;
        try {
          const resources = await this.ports.readResources(signal);
          if (signal.aborted) return;
          if (instanceId !== this.snapshot.instanceId) continue;
          this.publish({
            ...this.snapshot,
            gpu: resources.gpu,
            system: {
              ...resources,
              gpu: resources.gpu && {
                ...resources.gpu,
                utilization: resources.gpu.utilization ?? null,
                temperature: resources.gpu.temperature ?? null,
              },
            },
          });
        } catch {
          if (!signal.aborted)
            this.publish({
              ...this.snapshot,
              message: "Hardware readings could not refresh; previous readings may be stale.",
            });
        }
      }
    } catch {
      if (!signal.aborted)
        this.publish({
          ...this.snapshot,
          message: "Hardware readings could not refresh; previous readings may be stale.",
        });
    }
  }
  async execute<K extends BrainTuiActionType>(
    action: BrainTuiAction<K>,
    signal?: AbortSignal,
  ): Promise<BrainTuiResult<BrainTuiActions[K]["result"]>> {
    if (this.closed || !this.snapshot.availableActions.includes(action.type))
      return {
        status: "unsupported",
        message: "This operation is unavailable on the selected Brain owner.",
      };
    const lifetime = signal
      ? AbortSignal.any([signal, this.lifetime.signal])
      : this.lifetime.signal;
    const instanceId = this.snapshot.instanceId;
    try {
      let execution: BrainTuiExecution;
      if (action.type === "refresh" && !this.snapshot.availableActions.includes("profile.save"))
        execution = { kind: "accepted" };
      else execution = await this.ports.execute(action, instanceId, lifetime);
      lifetime.throwIfAborted();
      if (instanceId !== this.snapshot.instanceId)
        throw new TuiActionError(
          "conflict",
          "The Brain owner restarted. Reload before another operation.",
        );
      let value: unknown;
      if (execution.kind === "profile") {
        this.authority++;
        const { saved } = execution;
        const models = this.snapshot.models.map((row) =>
          row.model.id === execution.modelId
            ? Object.assign({}, row, {
                profile: saved.profile,
                revision: saved.revision,
                fields: saved.fields,
                warnings: saved.warnings,
                budget: saved.budget,
                maxContext: saved.maxContextThatFits,
                calibration:
                  saved.calibration.kvBytesPerToken === null
                    ? null
                    : {
                        kvBytesPerToken: saved.calibration.kvBytesPerToken,
                        inherited: saved.calibration.state === "inherited",
                      },
                calibrationStale: saved.calibration.state === "stale",
              })
            : row,
        );
        this.metadata = { ...this.metadata, models };
        this.publish({ ...this.snapshot, models });
      } else if (execution.kind === "job") {
        this.publish({
          ...this.snapshot,
          jobs: [
            ...this.snapshot.jobs.filter((job) => job.id !== execution.job.id),
            execution.job,
          ].slice(-100),
        });
        if (action.type !== "runtime.remove") value = { jobId: execution.job.id };
      } else if (execution.kind === "value") value = execution.value;
      else {
        this.authority++;
        await this.refreshMetadata();
      }
      return { status: "success", value: decodeTuiResult<K>(action.type, value) };
    } catch (error) {
      if (error instanceof TuiActionError) return { status: error.status, message: error.message };
      return {
        status: "failed",
        message:
          "The Brain request could not be confirmed. Read its current state before retrying.",
      };
    }
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.lifetime.abort();
    this.releaseDemand();
    this.listeners.clear();
    await this.ports.status.close();
  }
}
