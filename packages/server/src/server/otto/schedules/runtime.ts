import { isPaseoSchedule } from "@getpaseo/plugin/otto/schedules";
import type {
  ScheduleAudit,
  ScheduleExecutionResult,
  ScheduleRun,
  ScheduleRuntimeHooks,
  ScheduleSettlement,
  StoredSchedule,
} from "./types.js";
import { ScheduleError } from "./files.js";

export interface PreparedScheduleTarget {
  audit: Partial<ScheduleAudit>;
  execute(
    signal: AbortSignal,
    stamp: (audit: Partial<ScheduleAudit>) => Promise<void>,
  ): Promise<ScheduleExecutionResult>;
  /** Settled means the authoritative owner finished; not_started revokes a pre-effect admission. */
  cancel?(): Promise<"settled" | "not_started">;
  release?(): void;
}
export class ScheduleExecutionError extends Error {
  constructor(
    message: string,
    readonly disposition: "failed" | "canceled" | "unknown" | "repair_required",
    readonly audit: Partial<ScheduleAudit> = {},
    readonly repairReason?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
export interface ScheduleRuntimePorts {
  prepare(schedule: StoredSchedule, runId: string): Promise<PreparedScheduleTarget>;
  native?: {
    execute(
      input: Parameters<ScheduleRuntimeHooks["execute"]>[0],
    ): Promise<ScheduleExecutionResult>;
    stop(): Promise<void>;
  };
}
interface Active {
  scheduleId: string;
  controller: AbortController;
  prepared: PreparedScheduleTarget | null;
  done: Promise<void>;
  canceling?: Promise<void>;
}
/** Await cancellation without depending on a provider's prompt settlement. Late work retains the same
 * revoked signal and cannot publish; handlers observe eventual rejections and release late preflights. */
export function awaitScheduleEffect<T>(
  pending: Promise<T>,
  signal: AbortSignal,
  late?: (value: T) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    pending
      .then(
        (value) => {
          if (settled) {
            late?.(value);
            return undefined;
          }
          settled = true;
          signal.removeEventListener("abort", abort);
          resolve(value);
          return undefined;
        },
        (error) => {
          if (settled) return undefined;
          settled = true;
          signal.removeEventListener("abort", abort);
          reject(error);
          return undefined;
        },
      )
      .catch(reject);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
/** Bounded target work plugs into the existing scheduler; no timer, watcher, provider construction or chat state. */
export class ScheduleRuntime implements ScheduleRuntimeHooks {
  private active = new Map<string, Active>();
  private admitted = 0;
  private closed = false;
  constructor(readonly ports: ScheduleRuntimePorts) {}
  requested(schedule: StoredSchedule): ScheduleAudit {
    return { requestedTarget: structuredClone(schedule.target) };
  }
  acquire(schedule: StoredSchedule): (() => void) | null {
    if (this.closed) return null;
    if (isPaseoSchedule(schedule) && !this.ports.native) return () => {};
    if (this.admitted >= 5) return null;
    this.admitted++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.admitted--;
    };
  }
  async execute(
    input: Parameters<ScheduleRuntimeHooks["execute"]>[0],
  ): Promise<ScheduleExecutionResult> {
    if (this.closed)
      throw new ScheduleExecutionError(
        "Schedule target host is stopping.",
        "unknown",
        {},
        "Review this Schedule after host shutdown.",
      );
    if (isPaseoSchedule(input.schedule))
      return this.ports.native ? this.ports.native.execute(input) : input.legacy();
    let settle!: () => void;
    const done = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const active: Active = {
      scheduleId: input.schedule.id,
      controller: new AbortController(),
      prepared: null,
      done,
    };
    this.active.set(input.runId, active);
    let stage: "preflight" | "executing" = "preflight";
    try {
      const prepared = await awaitScheduleEffect(
        this.ports.prepare(input.schedule, input.runId),
        active.controller.signal,
        (late) => late.release?.(),
      );
      active.prepared = prepared;
      active.controller.signal.throwIfAborted();
      await input.stamp(prepared.audit);
      active.controller.signal.throwIfAborted();
      stage = "executing";
      const result = await awaitScheduleEffect(
        prepared.execute(active.controller.signal, input.stamp),
        active.controller.signal,
      );
      if (result.audit) await input.stamp(result.audit);
      return result;
    } catch (error) {
      if (error instanceof ScheduleExecutionError) throw error;
      if (active.controller.signal.aborted) throw active.controller.signal.reason;
      throw this.executionFailure(stage, error);
    } finally {
      this.active.delete(input.runId);
      settle();
      active.prepared?.release?.();
    }
  }
  private executionFailure(
    stage: "preflight" | "executing",
    error: unknown,
  ): ScheduleExecutionError {
    const message =
      error instanceof ScheduleError
        ? error.message
        : "Schedule target failed. Inspect this run before retrying.";
    if (
      stage === "preflight" &&
      error instanceof ScheduleError &&
      (error.kind === "busy" || error.kind === "unavailable")
    )
      // Explicit product policy: no retry timer or new attempt. Paseo owns the next cadence fire.
      return new ScheduleExecutionError(message, "failed", { failureCode: error.kind }, undefined, {
        cause: error,
      });
    const disposition = stage === "preflight" ? "repair_required" : "unknown";
    return new ScheduleExecutionError(
      message,
      disposition,
      { failureCode: error instanceof ScheduleError ? error.kind : "target_failed" },
      message,
      { cause: error },
    );
  }
  async cancel(scheduleId: string, runId: string): Promise<void> {
    const active = this.active.get(runId);
    if (!active || active.scheduleId !== scheduleId)
      throw new ScheduleError(
        "conflict",
        "This host instance does not own that active Schedule run.",
      );
    active.canceling ??= this.cancelOwned(active);
    return active.canceling;
  }
  private async cancelOwned(active: Active): Promise<void> {
    try {
      const canceled = await active.prepared?.cancel?.();
      if (canceled === "settled") {
        await active.done;
        return;
      }
    } catch (error) {
      const message =
        "Target cancellation could not be confirmed. Inspect the linked result before resuming this Schedule.";
      active.controller.abort(
        new ScheduleExecutionError(message, "unknown", {}, message, { cause: error }),
      );
      await active.done;
      throw new ScheduleError("unavailable", message, { cause: error });
    }
    active.controller.abort(
      new ScheduleExecutionError(
        "Schedule run canceled. Completed effects are retained.",
        "canceled",
      ),
    );
    await active.done;
  }
  settle(
    schedule: StoredSchedule,
    run: ScheduleRun,
    outcome: ScheduleSettlement,
  ): ReturnType<ScheduleRuntimeHooks["settle"]> {
    if ((isPaseoSchedule(schedule) && !this.ports.native) || !run.otto) return { run };
    let failure: ScheduleExecutionError | null = null;
    if (outcome.error instanceof ScheduleExecutionError) failure = outcome.error;
    else if (outcome.error !== undefined)
      failure = this.executionFailure("executing", outcome.error);
    const audit = outcome.result?.audit ?? failure?.audit ?? {};
    const otto = {
      ...run.otto,
      ...audit,
      requestedTarget: run.otto.requestedTarget,
      disposition: failure?.disposition ?? audit.disposition ?? "succeeded",
    };
    return {
      run: { ...run, otto },
      ...(failure?.repairReason ? { pauseReason: failure.repairReason } : {}),
    };
  }
  recover(schedule: StoredSchedule, run: ScheduleRun): ReturnType<ScheduleRuntimeHooks["recover"]> {
    if ((isPaseoSchedule(schedule) && !this.ports.native) || !run.otto) return { run };
    const message =
      "Host restarted before target settlement. Inspect the linked result and review this Schedule before resuming; it was not replayed.";
    return {
      run: { ...run, otto: { ...run.otto, disposition: "unknown", failureCode: "host_restarted" } },
      pauseReason: message,
    };
  }
  async stop() {
    this.closed = true;
    const current = [...this.active.values()];
    for (const active of current)
      active.controller.abort(
        new ScheduleExecutionError(
          "Schedule host stopped before settlement.",
          "unknown",
          {},
          "Inspect the interrupted target before resuming this Schedule.",
        ),
      );
    await Promise.all(current.map((active) => active.done));
    await this.ports.native?.stop();
  }
}
