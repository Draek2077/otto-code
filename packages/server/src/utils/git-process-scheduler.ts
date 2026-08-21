export interface GitProcessPolicy {
  maxProcessesPerSecond: number;
  maxProcessConcurrency: number;
}

export const DEFAULT_GIT_PROCESS_POLICY: GitProcessPolicy = {
  maxProcessesPerSecond: 64,
  maxProcessConcurrency: 8,
};

export interface ScheduledGitProcess<T> {
  result: Promise<T>;
  exited: Promise<void>;
}

export type GitProcessPriority = "normal" | "high";

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function resolveGitProcessPolicy(input: {
  env: NodeJS.ProcessEnv;
  persisted?: Partial<GitProcessPolicy>;
}): GitProcessPolicy {
  return {
    maxProcessesPerSecond:
      parsePositiveInteger(input.env.OTTO_GIT_MAX_PROCESSES_PER_SECOND) ??
      input.persisted?.maxProcessesPerSecond ??
      DEFAULT_GIT_PROCESS_POLICY.maxProcessesPerSecond,
    maxProcessConcurrency:
      parsePositiveInteger(input.env.OTTO_GIT_MAX_PROCESS_CONCURRENCY) ??
      // COMPAT(gitConcurrencyEnv): renamed in v0.2.6; remove after 2027-02-02.
      parsePositiveInteger(input.env.OTTO_GIT_CONCURRENCY) ??
      input.persisted?.maxProcessConcurrency ??
      DEFAULT_GIT_PROCESS_POLICY.maxProcessConcurrency,
  };
}

export class GitProcessScheduler {
  private readonly highPriorityQueue: Array<() => void> = [];
  private readonly normalPriorityQueue: Array<() => void> = [];
  private readonly refillIntervalMs: number;
  private availableStarts: number;
  private nextRefillAtMs: number;
  private admitted = 0;
  private running = 0;
  private waiting = 0;
  private rateTimer: NodeJS.Timeout | null = null;

  constructor(readonly policy: GitProcessPolicy) {
    this.availableStarts = policy.maxProcessesPerSecond;
    this.refillIntervalMs = 1_000 / policy.maxProcessesPerSecond;
    this.nextRefillAtMs = Date.now() + 1_000;
  }

  get activeCount(): number {
    return this.running;
  }

  get pendingCount(): number {
    return this.waiting;
  }

  run<T>(
    start: () => ScheduledGitProcess<T>,
    options?: { priority?: GitProcessPriority },
  ): Promise<T> {
    this.waiting += 1;
    return new Promise<T>((resolve, reject) => {
      const admit = () => {
        void this.execute(start, resolve, reject);
      };
      const queue =
        options?.priority === "high" ? this.highPriorityQueue : this.normalPriorityQueue;
      queue.push(admit);
      this.drain();
    });
  }

  private drain(): void {
    this.refillStarts();
    while (this.admitted < this.policy.maxProcessConcurrency) {
      if (this.availableStarts <= 0) {
        this.scheduleRateDrain();
        return;
      }
      const admit = this.highPriorityQueue.shift() ?? this.normalPriorityQueue.shift();
      if (!admit) {
        return;
      }
      this.admitted += 1;
      this.availableStarts -= 1;
      queueMicrotask(admit);
    }
  }

  private refillStarts(now = Date.now()): void {
    if (now < this.nextRefillAtMs) return;
    const refills = Math.floor((now - this.nextRefillAtMs) / this.refillIntervalMs) + 1;
    this.availableStarts = Math.min(
      this.policy.maxProcessesPerSecond,
      this.availableStarts + refills,
    );
    this.nextRefillAtMs += refills * this.refillIntervalMs;
    if (this.availableStarts === this.policy.maxProcessesPerSecond) {
      this.nextRefillAtMs = now + 1_000;
    }
  }

  private scheduleRateDrain(): void {
    if (this.rateTimer) return;
    const delay = Math.max(1, Math.ceil(this.nextRefillAtMs - Date.now()));
    this.rateTimer = setTimeout(() => {
      this.rateTimer = null;
      this.drain();
    }, delay);
  }

  private async execute<T>(
    start: () => ScheduledGitProcess<T>,
    resolve: (value: T | PromiseLike<T>) => void,
    reject: (reason?: unknown) => void,
  ): Promise<void> {
    this.waiting = Math.max(0, this.waiting - 1);
    this.running += 1;
    try {
      const process = start();
      void process.result.then(resolve, reject);
      await process.exited;
    } catch (error) {
      reject(error);
    } finally {
      this.running = Math.max(0, this.running - 1);
      this.admitted = Math.max(0, this.admitted - 1);
      this.drain();
    }
  }
}
