import type { WorkflowScope } from "@getpaseo/plugin/otto/workflows";
import { WorkflowError } from "./files.js";

/** Demand-owned long-poll notifications. No transcript subscriptions, intervals, idle timers or filesystem watchers. */
export class WorkflowChanges {
  private serial = 0;
  private readonly versions = new Map<string, number>();
  private readonly waiters = new Set<{ key: string; finish: () => void }>();
  private closed = false;
  private key(scope: WorkflowScope) {
    return JSON.stringify([scope.hostId, scope.projectId]);
  }
  version(scope: WorkflowScope) {
    return this.versions.get(this.key(scope)) ?? 0;
  }
  publish(scope: WorkflowScope): void {
    const key = this.key(scope);
    this.versions.delete(key);
    this.versions.set(key, ++this.serial);
    if (this.versions.size > 256) this.versions.delete(this.versions.keys().next().value!);
    for (const waiter of this.waiters) if (waiter.key === key) waiter.finish();
  }
  async watch(scope: WorkflowScope, version: number): Promise<{ version: number }> {
    if (this.closed) throw new WorkflowError("unavailable", "Workflow observation has stopped.");
    if (this.version(scope) !== version) return { version: this.version(scope) };
    if (this.waiters.size >= 32)
      throw new WorkflowError("busy", "Too many Workflow observers. Close unused panels.");
    let settle!: () => void;
    const pending = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const waiter = {
      key: this.key(scope),
      finish: () => {
        if (this.waiters.delete(waiter)) settle();
      },
    };
    const timer = setTimeout(waiter.finish, 25000);
    timer.unref();
    this.waiters.add(waiter);
    try {
      await pending;
    } finally {
      clearTimeout(timer);
      this.waiters.delete(waiter);
    }
    return { version: this.version(scope) };
  }
  close(): void {
    this.closed = true;
    for (const waiter of this.waiters) waiter.finish();
    this.versions.clear();
  }
}
