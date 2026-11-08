import { WorkflowError } from "./files.js";
type Outcome = { state: "pending" } | { state: "complete" } | { state: "failed"; error: unknown };
/** Per-active-run settlement, including AI Planning before an engine exists. Demand-owned waits,
 * no polling or idle timer; releasing a waiter never cancels the durable Workflow. */
export class WorkflowSettlement {
  private outcome: Outcome = { state: "pending" };
  private waiters = new Set<{ finish: (outcome: Outcome) => void }>();
  wait(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.outcome.state === "complete") return Promise.resolve();
    if (this.outcome.state === "failed") return Promise.reject(this.outcome.error);
    if (this.waiters.size >= 16)
      throw new WorkflowError(
        "busy",
        "Too many observers are waiting for this Workflow to settle.",
      );
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.waiters.delete(waiter);
        signal?.removeEventListener("abort", abort);
      };
      const abort = () => {
        cleanup();
        reject(signal?.reason);
      };
      const waiter = {
        finish: (outcome: Outcome) => {
          cleanup();
          if (outcome.state === "failed") reject(outcome.error);
          else resolve();
        },
      };
      this.waiters.add(waiter);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  complete(): void {
    this.finish({ state: "complete" });
  }
  fail(error: unknown): void {
    this.finish({ state: "failed", error });
  }
  private finish(outcome: Outcome): void {
    if (this.outcome.state !== "pending") return;
    this.outcome = outcome;
    for (const waiter of this.waiters) waiter.finish(outcome);
  }
}
