import type { AgentManager } from "../../agent/agent-manager.js";
import type { ScheduleRuntimeHooks, StoredSchedule } from "./types.js";
import type { ScheduleRegistry } from "./registry.js";
import { ScheduleExecutionError, awaitScheduleEffect } from "./runtime.js";
import { scheduleTurnOptions, type ScheduleTurnReceipt } from "./turn-authority.js";
import { ScheduleError } from "./files.js";

export interface ScheduleNativePorts {
  manager: Pick<AgentManager, "getAgent" | "cancelAgentRun">;
  registry: ScheduleRegistry;
  validate(schedule: StoredSchedule): Promise<void>;
  onLateError(scheduleId: string, runId: string, error: unknown): void;
}
interface NativeAttempt {
  scheduleId: string;
  runId: string;
  controller: AbortController;
  receipt: ScheduleTurnReceipt | null;
  rawSettled: boolean;
  preflightComplete: boolean;
  done: Promise<void>;
  canceling?: Promise<void>;
}
/** Owns only a Schedule's exact native turn. Provisioning and provider execution
 * remain in Paseo. Aborted, non-cooperative work retains a bounded reservation. */
export class ScheduleNativeOwner {
  private closed = false;
  private active = new Map<string, NativeAttempt>();
  constructor(readonly ports: ScheduleNativePorts) {}
  async execute(input: Parameters<ScheduleRuntimeHooks["execute"]>[0]) {
    if (this.closed || this.active.size >= 5 || this.active.has(input.runId))
      throw new ScheduleExecutionError(
        "Native Schedule capacity is unavailable. Waiting until the next scheduled time.",
        "failed",
        { failureCode: "busy" },
      );
    let finish!: () => void;
    const attempt: NativeAttempt = {
      scheduleId: input.schedule.id,
      runId: input.runId,
      controller: new AbortController(),
      receipt: null,
      rawSettled: false,
      preflightComplete: false,
      done: new Promise<void>((resolve) => {
        finish = resolve;
      }),
    };
    this.active.set(input.runId, attempt);
    const raw = this.executeOwned(input, attempt);
    const release = () => {
      attempt.rawSettled = true;
      if (this.active.get(input.runId) === attempt) this.active.delete(input.runId);
    };
    void raw.then(release, release);
    try {
      return await awaitScheduleEffect(raw, attempt.controller.signal);
    } catch (error) {
      if (error instanceof ScheduleExecutionError) throw error;
      if (!attempt.preflightComplete && error instanceof ScheduleError) {
        const transient = error.kind === "busy" || error.kind === "unavailable";
        throw new ScheduleExecutionError(
          error.message,
          transient ? "failed" : "repair_required",
          { failureCode: error.kind },
          transient ? undefined : error.message,
          { cause: error },
        );
      }
      const provenBusy =
        !attempt.receipt && error instanceof ScheduleError && error.kind === "busy";
      const message =
        error instanceof ScheduleError
          ? error.message
          : "Native Schedule execution could not be confirmed. Inspect the linked chat before resuming.";
      throw new ScheduleExecutionError(
        message,
        provenBusy ? "failed" : "unknown",
        {},
        provenBusy ? undefined : message,
        { cause: error },
      );
    } finally {
      finish();
    }
  }
  private async executeOwned(
    input: Parameters<ScheduleRuntimeHooks["execute"]>[0],
    attempt: NativeAttempt,
  ) {
    await this.ports.validate(input.schedule);
    attempt.preflightComplete = true;
    attempt.controller.signal.throwIfAborted();
    return input.legacy(async (agentId) => {
      attempt.controller.signal.throwIfAborted();
      const agent = this.ports.manager.getAgent(agentId);
      if (!agent) throw new ScheduleError("invalid", "The scheduled chat is unavailable.");
      const updated = await this.ports.registry.update(input.schedule.id, (record) => {
        const run = record.runs.find((item) => item.id === input.runId);
        if (!run || run.status !== "running")
          throw new ScheduleError(
            "conflict",
            "This Schedule attempt no longer owns a running claim.",
          );
        return {
          ...record,
          runs: record.runs.map((item) =>
            item.id === input.runId
              ? {
                  ...item,
                  agentId,
                  ...(agent.workspaceId ? { workspaceId: agent.workspaceId } : {}),
                }
              : item,
          ),
        };
      });
      if (!updated)
        throw new ScheduleError("invalid", "Schedule disappeared before its native turn.");
      await input.stamp({
        resolved: {
          kind: input.schedule.target.type === "agent" ? "agent" : "new-agent",
          id: agentId,
          title: agent.config.title ?? agentId,
        },
        executor: agent.provider,
        result: {
          kind: "chat",
          agentId,
          ...(agent.workspaceId ? { workspaceId: agent.workspaceId } : {}),
        },
      });
      attempt.controller.signal.throwIfAborted();
      return scheduleTurnOptions(
        agentId,
        () => !attempt.controller.signal.aborted,
        (receipt) => {
          attempt.receipt = receipt;
          // The provider may acknowledge a start after the user canceled or shutdown.
          // Only its bound receipt may be interrupted, never a reloaded/manual session.
          if (attempt.controller.signal.aborted)
            void this.interrupt(attempt).catch((error: unknown) =>
              this.ports.onLateError(attempt.scheduleId, attempt.runId, error),
            );
        },
      );
    });
  }
  async cancel(scheduleId: string, runId: string) {
    const attempt = this.active.get(runId);
    if (!attempt || attempt.scheduleId !== scheduleId)
      throw new ScheduleError(
        "conflict",
        "This host instance does not own that native Schedule attempt.",
      );
    attempt.canceling ??= this.cancelOwned(attempt);
    return attempt.canceling;
  }
  private async interrupt(attempt: NativeAttempt) {
    if (!attempt.receipt)
      throw new ScheduleError(
        "unavailable",
        "Provider start is still pending; its outcome requires inspection.",
      );
    const result = await this.ports.manager.cancelAgentRun(
      attempt.receipt.agentId,
      attempt.receipt,
    );
    if (result.status !== "settled" && !attempt.rawSettled)
      throw new ScheduleError(
        "unavailable",
        "Exact native turn cancellation could not be confirmed. Inspect the chat before resuming.",
      );
  }
  private async cancelOwned(attempt: NativeAttempt) {
    try {
      await this.interrupt(attempt);
    } catch (error) {
      const message =
        "Native cancellation has an uncertain outcome. Inspect the linked chat before resuming this Schedule.";
      attempt.controller.abort(
        new ScheduleExecutionError(message, "unknown", {}, message, { cause: error }),
      );
      await attempt.done;
      throw new ScheduleError("unavailable", message, { cause: error });
    }
    attempt.controller.abort(
      new ScheduleExecutionError(
        "Native Schedule turn canceled. Completed effects are retained.",
        "canceled",
      ),
    );
    await attempt.done;
  }
  async stop() {
    this.closed = true;
    const active = [...this.active.values()];
    for (const attempt of active) {
      const message =
        "Host stopped before native Schedule settlement. Inspect its linked chat before resuming.";
      attempt.controller.abort(new ScheduleExecutionError(message, "unknown", {}, message));
      if (attempt.receipt && !attempt.canceling)
        void this.interrupt(attempt).catch((error: unknown) =>
          this.ports.onLateError(attempt.scheduleId, attempt.runId, error),
        );
    }
    await Promise.all(active.map((attempt) => attempt.done));
  }
}
