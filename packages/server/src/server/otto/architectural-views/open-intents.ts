import { randomUUID } from "node:crypto";
import type { ViewIdentity } from "@getpaseo/plugin/otto/architectural-views";
import { ArchitecturalViewError } from "./specification.js";
interface Intent {
  cursor: string;
  identity: ViewIdentity | null;
}
interface Lease {
  clientId: string;
  workspaceId: string;
  timer: ReturnType<typeof setTimeout>;
  wake: (() => void) | null;
  waiting: boolean;
}
/** Volatile display intent, never content or chat/session state. Only demanded
 * workspace leases exist; disconnect/expiry removes all timers and waiters. */
export class ViewOpenIntents {
  private readonly intents = new Map<string, Intent>();
  private readonly leases = new Map<string, Lease>();
  private closed = false;
  read(workspaceId: string): Intent {
    return this.intents.get(workspaceId) ?? { cursor: "initial", identity: null };
  }
  show(workspaceId: string, identity: ViewIdentity) {
    if (this.closed) throw new ArchitecturalViewError("unavailable", "The host is shutting down.");
    if (!this.intents.has(workspaceId) && this.intents.size >= 256)
      this.intents.delete(this.intents.keys().next().value!);
    this.intents.set(workspaceId, { cursor: randomUUID(), identity });
    for (const lease of this.leases.values()) if (lease.workspaceId === workspaceId) lease.wake?.();
  }
  async wait(
    clientId: string,
    leaseId: string,
    workspaceId: string,
    cursor: string | null,
  ): Promise<Intent> {
    if (this.closed || !clientId)
      throw new ArchitecturalViewError("unavailable", "View display needs a live paired session.");
    const key = JSON.stringify([clientId, leaseId]);
    let lease = this.leases.get(key);
    if (!lease) {
      if (
        this.leases.size >= 64 ||
        [...this.leases.values()].filter((entry) => entry.clientId === clientId).length >= 8
      )
        throw new ArchitecturalViewError("busy", "Too many View display subscriptions.");
      lease = { clientId, workspaceId, timer: this.expiry(key), wake: null, waiting: false };
      this.leases.set(key, lease);
    }
    if (lease.workspaceId !== workspaceId || lease.waiting)
      throw new ArchitecturalViewError(
        "invalid",
        "This display lease already has another workspace or wait.",
      );
    clearTimeout(lease.timer);
    lease.timer = this.expiry(key);
    lease.waiting = true;
    try {
      if (cursor === this.read(workspaceId).cursor) await this.changed(lease);
      if (this.leases.get(key) !== lease)
        throw new ArchitecturalViewError("unavailable", "View display was released.");
      return this.read(workspaceId);
    } finally {
      lease.waiting = false;
    }
  }
  private changed(lease: Lease) {
    let complete = () => {};
    const promise = new Promise<void>((resolve) => {
      complete = resolve;
    });
    let settled = false;
    const timer = setTimeout(() => wake(), 20000);
    const wake = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lease.wake = null;
      complete();
    };
    timer.unref();
    lease.wake = wake;
    return promise;
  }
  private expiry(key: string) {
    const timer = setTimeout(() => this.releaseKey(key), 30000);
    timer.unref();
    return timer;
  }
  private releaseKey(key: string) {
    const lease = this.leases.get(key);
    if (!lease) return;
    this.leases.delete(key);
    clearTimeout(lease.timer);
    lease.wake?.();
  }
  release(clientId: string, leaseId: string) {
    this.releaseKey(JSON.stringify([clientId, leaseId]));
  }
  releaseClient(clientId: string) {
    for (const [key, lease] of this.leases) if (lease.clientId === clientId) this.releaseKey(key);
  }
  close() {
    this.closed = true;
    for (const key of this.leases.keys()) this.releaseKey(key);
    this.intents.clear();
  }
}
