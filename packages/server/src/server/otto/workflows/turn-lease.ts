import { WorkflowSlots } from "./run-state.js";
import { WorkflowError } from "./files.js";

/** A waiting parent yields only model-turn capacity, retaining its workspace writer lock. */
export class WorkflowTurnLease {
  private release: (() => void) | null = null;
  private suspended = false;
  constructor(
    private readonly global: WorkflowSlots,
    private readonly run: WorkflowSlots,
    private readonly signal: AbortSignal,
  ) {}
  async acquire(): Promise<void> {
    const local = await this.run.acquire(this.signal);
    try {
      const global = await this.global.acquire(this.signal);
      this.release = () => {
        global();
        local();
      };
    } catch (error) {
      local();
      throw error;
    }
  }
  close(): void {
    this.release?.();
    this.release = null;
  }
  async whileWaiting<T>(operation: () => Promise<T>): Promise<T> {
    if (this.suspended || !this.release)
      throw new WorkflowError(
        "busy",
        "Wait for the current managed delegation before starting another.",
      );
    this.suspended = true;
    this.close();
    try {
      return await operation();
    } finally {
      try {
        if (!this.signal.aborted) await this.acquire();
      } finally {
        this.suspended = false;
      }
    }
  }
}
