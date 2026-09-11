import { getGlobalSingleton } from "./global-singleton";

export interface CaptureOperation {
  id: number;
  name: string;
  kind: "sync" | "async";
  at: number;
  /** Async spans include waiting, and must not be read as CPU time. */
  durationMs: number;
  status: "complete" | "error" | "pending";
  context?: { serverId?: string; agentId?: string; items?: number; bytes?: number };
}

const OPERATION_CAPACITY = 500;
const PENDING_CAPACITY = 100;
const now = () => performance.timeOrigin + performance.now();

/** Capture-scoped, bounded metadata only. Never records prompts, audio or errors. */
export class CaptureOperationRecorder {
  active = false;
  private generation = 0;
  private sequence = 0;
  private entries: CaptureOperation[] = [];
  private pending = new Map<number, CaptureOperation>();
  private dropped = 0;

  constructor(private readonly clock: () => number = now) {}

  start(): void {
    this.generation++;
    this.active = true;
    this.entries = [];
    this.pending.clear();
    this.dropped = 0;
  }

  begin(
    name: string,
    kind: CaptureOperation["kind"],
    context?: CaptureOperation["context"],
  ): (failed?: boolean) => void {
    if (!this.active) return () => {};
    if (this.pending.size >= PENDING_CAPACITY) {
      this.dropped++;
      return () => {};
    }
    const generation = this.generation;
    const entry: CaptureOperation = {
      id: ++this.sequence,
      name,
      kind,
      at: this.clock(),
      durationMs: 0,
      status: "pending",
      context,
    };
    this.pending.set(entry.id, entry);
    return (failed = false) => {
      if (!this.active || generation !== this.generation || !this.pending.delete(entry.id)) return;
      this.entries.push({
        ...entry,
        durationMs: Math.max(0, this.clock() - entry.at),
        status: failed ? "error" : "complete",
      });
      if (this.entries.length > OPERATION_CAPACITY) {
        this.entries.shift();
        this.dropped++;
      }
    };
  }

  report(until = this.clock()): { entries: CaptureOperation[]; dropped: number } {
    return {
      entries: [
        ...this.entries,
        ...Array.from(this.pending.values(), (entry) => ({
          ...entry,
          durationMs: Math.max(0, until - entry.at),
        })),
      ]
        .filter((entry) => entry.at <= until)
        .sort((a, b) => a.at - b.at),
      dropped: this.dropped,
    };
  }

  stop(until = this.clock()): ReturnType<CaptureOperationRecorder["report"]> {
    const report = this.report(until);
    this.active = false;
    this.pending.clear();
    return report;
  }
}

export const captureOperations = getGlobalSingleton(
  "otto.diagnostics.captureOperations",
  () => new CaptureOperationRecorder(),
);

export function traceCaptureSync<T>(
  name: string,
  run: () => T,
  context?: CaptureOperation["context"],
): T {
  if (!captureOperations.active) return run();
  const end = captureOperations.begin(name, "sync", context);
  try {
    const result = run();
    end();
    return result;
  } catch (error) {
    end(true);
    throw error;
  }
}

export function traceCaptureAsync<T>(
  name: string,
  run: () => Promise<T>,
  context?: CaptureOperation["context"],
): Promise<T> {
  if (!captureOperations.active) return run();
  const end = captureOperations.begin(name, "async", context);
  try {
    return run().then(
      (result) => {
        end();
        return result;
      },
      (error: unknown) => {
        end(true);
        throw error;
      },
    );
  } catch (error) {
    end(true);
    throw error;
  }
}
