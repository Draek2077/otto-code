/** One demand-owned host feed for every Brain consumer. Transport and validation are injected. */
export interface BrainStatusLog {
  index: number;
  line: string;
}
export interface BrainSourceLog extends BrainStatusLog {
  instanceId: string;
}
export interface BrainStatusSnapshot<Status> {
  cursor: string;
  connection: "connecting" | "connected" | "disconnected";
  status: Status | null;
  logs: readonly BrainStatusLog[];
  firstLogIndex: number;
  nextLogIndex: number;
  error: string | null;
}
export interface BrainStatusSource<Status> {
  /** Resolves/rejects when the single stream ends; must settle after signal abort. */
  open(
    receive: { status(value: Status): void; log(record: BrainSourceLog): void },
    signal: AbortSignal,
  ): Promise<void>;
}
interface Session {
  abort: AbortController;
  done: Promise<void>;
  logs: BrainSourceLog[];
  logBytes: number;
}
interface StoreOptions {
  streamId: string;
  maxLogLines?: number;
  maxLogBytes?: number;
}
const ENCODER = new TextEncoder();

export class BrainStatusStore<Status extends { instanceId: string }> {
  private snapshot: BrainStatusSnapshot<Status>;
  private statusSnapshot: BrainStatusSnapshot<Status>;
  private listeners = new Set<() => void>();
  private waiters = new Set<(error?: Error) => void>();
  private session: Session | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private demands = 0;
  private closed = false;
  private revision = 0;
  private epoch = 0;
  private failures = 0;
  private logBytes = 0;
  private readonly lineLimit: number;
  private readonly byteLimit: number;
  constructor(
    private readonly source: BrainStatusSource<Status>,
    private readonly options: StoreOptions,
  ) {
    if (!options.streamId || options.streamId.length > 128)
      throw new Error("A bounded Brain stream identity is required");
    this.lineLimit = options.maxLogLines ?? 1000;
    this.byteLimit = options.maxLogBytes ?? 1024 * 1024;
    if (
      !Number.isInteger(this.lineLimit) ||
      this.lineLimit < 1 ||
      this.lineLimit > 2000 ||
      !Number.isInteger(this.byteLimit) ||
      this.byteLimit < 1 ||
      this.byteLimit > 1024 * 1024
    )
      throw new Error("Invalid Brain log limits");
    this.snapshot = Object.freeze({
      cursor: this.cursor(),
      connection: "disconnected",
      status: null,
      logs: [],
      firstLogIndex: 0,
      nextLogIndex: 0,
      error: null,
    });
    this.statusSnapshot = this.snapshot;
  }
  getSnapshot = (): BrainStatusSnapshot<Status> => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    if (this.closed) throw new Error("Brain status store is closed");
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  retain(): () => void {
    if (this.closed) throw new Error("Brain status store is closed");
    this.demands++;
    this.ensureStream();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.demands--;
      if (this.closed) return;
      if (this.demands !== 0) return;
      this.cancelRetry();
      this.session?.abort.abort();
      this.publish({ ...this.snapshot, connection: "disconnected" });
    };
  }

  /** An explicit owner/connection change invalidates stale data before reconnecting. */
  invalidate(): void {
    if (this.closed) throw new Error("Brain status store is closed");
    this.cancelRetry();
    this.epoch++;
    this.failures = 0;
    this.logBytes = 0;
    this.session?.abort.abort();
    this.publish({
      ...this.snapshot,
      connection: this.demands > 0 ? "connecting" : "disconnected",
      status: null,
      logs: [],
      firstLogIndex: 0,
      nextLogIndex: 0,
      error: null,
    });
    // runStream waits for the old source to settle before opening its replacement.
    this.ensureStream();
  }

  /** Bounded waits over an existing feed; waiting itself never creates host demand. */
  async wait(
    cursor: string | null,
    signal: AbortSignal,
    timeoutMs = 20000,
    includeLogs = true,
  ): Promise<BrainStatusSnapshot<Status>> {
    if (this.closed) throw new Error("Brain status store is closed");
    signal.throwIfAborted();
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20000)
      throw new Error("Invalid Brain wait deadline");
    const selected = () => (includeLogs ? this.snapshot : this.statusSnapshot);
    if (cursor !== selected().cursor) return selected();
    if (this.waiters.size >= 64) throw new Error("Too many Brain status waiters");
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", aborted);
        this.waiters.delete(changed);
        if (error) reject(error);
        else resolve(selected());
      };
      const changed = (error?: Error) => {
        if (error || cursor !== selected().cursor) finish(error);
      };
      const aborted = () =>
        finish(new Error("Brain status wait canceled", { cause: signal.reason }));
      const timer = setTimeout(finish, timeoutMs);
      this.waiters.add(changed);
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) aborted();
    });
  }

  async close(): Promise<void> {
    if (this.closed) return this.session?.done;
    this.closed = true;
    this.cancelRetry();
    for (const finish of this.waiters) finish(new Error("Brain status store is closed"));
    this.session?.abort.abort();
    this.publish({
      ...this.snapshot,
      connection: "disconnected",
      status: null,
      logs: [],
      firstLogIndex: this.snapshot.nextLogIndex,
    });
    this.listeners.clear();
    await this.session?.done;
  }

  private cursor(): string {
    return JSON.stringify([this.options.streamId, this.epoch, this.revision]);
  }
  private publish(next: BrainStatusSnapshot<Status>, logsOnly = false): void {
    this.revision++;
    this.snapshot = Object.freeze({ ...next, cursor: this.cursor() });
    if (!logsOnly) this.statusSnapshot = Object.freeze({ ...this.snapshot, logs: [] });
    for (const finish of this.waiters) finish();
    for (const listener of this.listeners) listener();
  }
  private current(session: Session): boolean {
    return (
      !this.closed && this.demands > 0 && this.session === session && !session.abort.signal.aborted
    );
  }
  private ensureStream(): void {
    if (this.closed || this.demands === 0 || this.session || this.retry) return;
    const session: Session = {
      abort: new AbortController(),
      done: Promise.resolve(),
      logs: [],
      logBytes: 0,
    };
    this.session = session;
    this.publish({ ...this.snapshot, connection: "connecting", error: null });
    session.done = Promise.resolve().then(() => this.runStream(session));
  }
  private async runStream(session: Session): Promise<void> {
    try {
      if (!this.current(session)) return;
      await this.source.open(
        {
          status: (value) => this.receiveStatus(session, value),
          log: (line) => this.receiveLog(session, line),
        },
        session.abort.signal,
      );
    } catch {
      // Source errors may contain credentials or owner paths; publish fixed display text.
    } finally {
      if (this.session === session) {
        this.session = null;
        if (!this.closed && this.demands > 0) this.afterStream(session.abort.signal.aborted);
      }
    }
  }
  private afterStream(aborted: boolean): void {
    if (aborted) {
      this.ensureStream();
      return;
    }
    this.publish({
      ...this.snapshot,
      connection: "disconnected",
      error: "The Brain host event feed disconnected",
    });
    const delay = Math.min(15000, 250 * 2 ** Math.min(this.failures++, 6));
    this.retry = setTimeout(() => {
      this.retry = null;
      this.ensureStream();
    }, delay);
  }
  private cancelRetry(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
  }
  private receiveStatus(session: Session, value: Status): void {
    if (!this.current(session)) return;
    this.failures = 0;
    const changedOwner =
      this.snapshot.status !== null && this.snapshot.status.instanceId !== value.instanceId;
    if (changedOwner) {
      this.epoch++;
      this.logBytes = 0;
    }
    this.publish({
      ...this.snapshot,
      connection: "connected",
      status: Object.freeze(structuredClone(value)),
      error: null,
      ...(changedOwner ? { logs: [], firstLogIndex: 0, nextLogIndex: 0 } : {}),
    });
    const pending = session.logs;
    session.logs = [];
    session.logBytes = 0;
    for (const record of pending) {
      if (record.instanceId === value.instanceId) this.receiveLog(session, record);
    }
  }
  private receiveLog(session: Session, record: BrainSourceLog): void {
    if (!this.current(session)) return;
    const bytes = ENCODER.encode(record.line);
    const text = new TextDecoder().decode(bytes.subarray(0, Math.min(8192, this.byteLimit)), {
      stream: true,
    });
    if (this.snapshot.status?.instanceId !== record.instanceId) {
      session.logs.push({ ...record, line: text });
      session.logBytes += ENCODER.encode(text).length;
      while (session.logs.length > this.lineLimit || session.logBytes > this.byteLimit) {
        const removed = session.logs.shift();
        if (removed) session.logBytes -= ENCODER.encode(removed.line).length;
      }
      return;
    }
    if (record.index < this.snapshot.nextLogIndex) return;
    const gap = record.index > this.snapshot.nextLogIndex;
    if (gap) this.logBytes = 0;
    const logs = [
      ...(gap ? [] : this.snapshot.logs),
      Object.freeze({ index: record.index, line: text }),
    ];
    this.logBytes += ENCODER.encode(text).length;
    while (logs.length > this.lineLimit || this.logBytes > this.byteLimit) {
      const removed = logs.shift();
      if (removed) this.logBytes -= ENCODER.encode(removed.line).length;
    }
    this.publish(
      {
        ...this.snapshot,
        logs: Object.freeze(logs),
        nextLogIndex: record.index + 1,
        firstLogIndex: logs[0]?.index ?? record.index + 1,
      },
      true,
    );
  }
}
