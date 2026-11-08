import type { ScheduleScope } from "@getpaseo/plugin/otto/schedules";
import { ScheduleError } from "./files.js";

/** Active-demand notifications only. No idle timer, provider, transcript subscription,
 * filesystem watcher, or additional scheduler. Discovery stays on the existing clock. */
export class ScheduleChanges {
  private serial = 0;
  private aggregate = 0;
  private hostEpoch = 0;
  private readonly versions = new Map<string, number>();
  private readonly waiters = new Set<{ projectId: string | null; finish(): void }>();
  private closed = false;
  constructor(readonly hostId: string) {}
  private host(scope: ScheduleScope) {
    if (scope.hostId !== this.hostId)
      throw new ScheduleError("invalid", "Select the owning Schedule host.");
  }
  version(scope: ScheduleScope) {
    this.host(scope);
    return scope.projectId === null
      ? this.aggregate
      : Math.max(this.hostEpoch, this.versions.get(scope.projectId) ?? 0);
  }
  publish(scope: ScheduleScope) {
    this.host(scope);
    if (this.closed) return;
    const version = ++this.serial;
    this.aggregate = version;
    if (scope.projectId === null) this.hostEpoch = version;
    else {
      this.versions.delete(scope.projectId);
      this.versions.set(scope.projectId, version);
      if (this.versions.size > 256) this.versions.delete(this.versions.keys().next().value!);
    }
    for (const waiter of this.waiters)
      if (
        scope.projectId === null ||
        waiter.projectId === null ||
        waiter.projectId === scope.projectId
      )
        waiter.finish();
  }
  async watch(scope: ScheduleScope, version: number) {
    this.host(scope);
    if (this.closed) throw new ScheduleError("unavailable", "Schedule observation has stopped.");
    if (this.version(scope) !== version) return { version: this.version(scope) };
    if (this.waiters.size >= 32)
      throw new ScheduleError("busy", "Too many Schedule observers. Close unused panels.");
    let settle!: () => void;
    const pending = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const waiter = {
      projectId: scope.projectId,
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
    if (this.closed) throw new ScheduleError("unavailable", "Schedule observation has stopped.");
    return { version: this.version(scope) };
  }
  close() {
    this.closed = true;
    for (const waiter of this.waiters) waiter.finish();
    this.versions.clear();
  }
}
