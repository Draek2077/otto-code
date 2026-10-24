/** Host-owned jobs outlive request sockets, but never their owning host. */
import { randomUUID } from "node:crypto";

export type BrainJobOperation =
  | "calibrate"
  | "sweep"
  | "benchmark"
  | "pull"
  | "runtime-install"
  | "runtime-remove";
export type BrainJobState = "queued" | "running" | "completed" | "failed" | "canceled";
export type JobValue = null | boolean | number | string | JobValue[] | { [key: string]: JobValue };
export interface BrainJobSubject {
  modelId: string | null;
  catalogModelId: string | null;
  repo: string | null;
  quant: string | null;
}
export interface BrainJob {
  id: string;
  operation: BrainJobOperation;
  subject: BrainJobSubject;
  state: BrainJobState;
  cancelRequested: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  progress: JobValue;
  result: JobValue;
  error: string | null;
}
export interface BrainJobContext {
  signal: AbortSignal;
  started(): void;
  progress(value: JobValue): void;
}
interface OwnedJob {
  snapshot: BrainJob;
  controller: AbortController;
  settled: Promise<void>;
}
const ACTIVE = new Set<BrainJobState>(["queued", "running"]);
const MAX_PAYLOAD_BYTES = 256 * 1024;

function copyValue(value: JobValue, limit = MAX_PAYLOAD_BYTES): JobValue {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > limit) throw new Error("Brain job payload is too large");
  return JSON.parse(json) as JobValue;
}

export class BrainJobs {
  private readonly jobs = new Map<string, OwnedJob>();
  private closed = false;
  private stopping: Promise<void> | null = null;

  constructor(
    private readonly changed: () => void,
    private readonly limits = { active: 16, retained: 100 },
  ) {
    if (
      !Number.isSafeInteger(limits.active) ||
      limits.active < 1 ||
      !Number.isSafeInteger(limits.retained) ||
      limits.retained < limits.active
    )
      throw new Error("Invalid Brain job limits");
  }

  list(includeResults = true): BrainJob[] {
    return [...this.jobs.values()].map(({ snapshot }) =>
      structuredClone(includeResults ? snapshot : { ...snapshot, result: null }),
    );
  }

  get(id: string): BrainJob | null {
    const job = this.jobs.get(id);
    return job ? structuredClone(job.snapshot) : null;
  }

  /** Complete results are read explicitly; status streams remain small. */
  summaries(): Omit<BrainJob, "progress" | "result">[] {
    return [...this.jobs.values()].map(({ snapshot }) => {
      const { progress: _progress, result: _result, ...summary } = snapshot;
      return structuredClone(summary);
    });
  }

  start(
    operation: BrainJobOperation,
    subject: BrainJobSubject,
    run: (context: BrainJobContext) => Promise<JobValue>,
  ): BrainJob {
    if (this.closed) throw new Error("Brain jobs are closed");
    if (
      [...this.jobs.values()].filter((job) => ACTIVE.has(job.snapshot.state)).length >=
      this.limits.active
    )
      throw new Error("Brain job limit reached");
    this.prune();
    const snapshot: BrainJob = {
      id: randomUUID(),
      operation,
      subject: { ...subject },
      state: "queued",
      cancelRequested: false,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      progress: null,
      result: null,
      error: null,
    };
    const controller = new AbortController();
    const job: OwnedJob = { snapshot, controller, settled: Promise.resolve() };
    this.jobs.set(snapshot.id, job);
    job.settled = Promise.resolve().then(() => this.execute(job, run));
    this.changed();
    return structuredClone(snapshot);
  }

  private async execute(
    job: OwnedJob,
    run: (context: BrainJobContext) => Promise<JobValue>,
  ): Promise<void> {
    const { snapshot, controller } = job;
    const { signal } = controller;
    try {
      signal.throwIfAborted();
      const result = await run({
        signal,
        started: () => {
          signal.throwIfAborted();
          if (snapshot.state === "queued") {
            snapshot.state = "running";
            snapshot.startedAt = new Date().toISOString();
            this.changed();
          }
        },
        progress: (value) => {
          signal.throwIfAborted();
          snapshot.progress = copyValue(value, 8 * 1024);
          this.changed();
        },
      });
      signal.throwIfAborted();
      snapshot.result = copyValue(result);
      snapshot.state = "completed";
    } catch {
      snapshot.state = signal.aborted ? "canceled" : "failed";
      // Native/network errors can contain host credentials or paths.
      snapshot.error = signal.aborted ? null : "Brain operation failed";
    } finally {
      snapshot.finishedAt = new Date().toISOString();
      this.changed();
    }
    return undefined;
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (ACTIVE.has(job.snapshot.state) && !job.snapshot.cancelRequested) {
      job.snapshot.cancelRequested = true;
      job.controller.abort(new Error("Brain job canceled"));
      this.changed();
    }
    return true;
  }

  async wait(id: string): Promise<BrainJob | null> {
    const job = this.jobs.get(id);
    if (!job) return null;
    await job.settled;
    return structuredClone(job.snapshot);
  }

  close(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.closed = true;
    for (const job of this.jobs.values()) this.cancel(job.snapshot.id);
    this.stopping = Promise.all([...this.jobs.values()].map((job) => job.settled)).then(
      () => undefined,
    );
    return this.stopping;
  }

  private prune(): void {
    for (const [id, job] of this.jobs) {
      if (this.jobs.size < this.limits.retained) return;
      if (!ACTIVE.has(job.snapshot.state)) this.jobs.delete(id);
    }
  }
}
