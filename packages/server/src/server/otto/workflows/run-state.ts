import type {
  WorkflowEntry,
  WorkflowLaunch,
  WorkflowRunRecord,
  RunPlan,
} from "@getpaseo/plugin/otto/workflows";
import type { WorkflowWorkspace, WorkflowAgentBinding } from "./runtime-ports.js";
import type { RunEngineAwaitResult, RunEngineGateDecision } from "./workflow-engine.js";
import type { WorkflowTurnLease } from "./turn-lease.js";
import type { WorkflowSettlement } from "./settlement.js";

export interface ActiveWorkflow {
  entry: WorkflowEntry;
  run: WorkflowRunRecord;
  launch: WorkflowLaunch;
  workspace: WorkflowWorkspace;
  abort: AbortController;
  plan?: RunPlan;
  engine: Promise<void> | null;
  settlement: WorkflowSettlement;
  publications: Promise<void>;
  failure: unknown;
  cancelRequested: boolean;
  admitted: boolean;
  closing: boolean;
  recoveryRequired: boolean;
  agents: Map<string, WorkflowAgentBinding>;
  members: Map<string, AbortController>;
  pending: Set<Promise<unknown>>;
  turns: Map<string, Promise<RunEngineAwaitResult>>;
  turnCapacity: WorkflowSlots;
  leases: Map<string, WorkflowTurnLease>;
  gates: Map<string, (value: RunEngineGateDecision) => void>;
  deadline: ReturnType<typeof setTimeout> | null;
}

/** FIFO cancellation-aware admission, no idle timer or model work. */
export class WorkflowSlots {
  private used = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(readonly capacity: number) {}
  async acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (this.used < this.capacity) {
      this.used++;
      return this.release();
    }
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => signal.removeEventListener("abort", aborted);
      const ready = () => {
        cleanup();
        resolve();
      };
      const aborted = () => {
        const index = this.waiting.indexOf(ready);
        if (index >= 0) this.waiting.splice(index, 1);
        cleanup();
        reject(signal.reason);
      };
      this.waiting.push(ready);
      signal.addEventListener("abort", aborted, { once: true });
    });
    if (signal.aborted) {
      this.release()();
      signal.throwIfAborted();
    }
    return this.release();
  }
  private release(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      if (next) next();
      else this.used--;
    };
  }
}
