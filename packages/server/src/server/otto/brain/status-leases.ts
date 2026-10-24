/** RPC waits retain one daemon-owned feed, scoped to the authenticated client session. */
import type { BrainStatusStore } from "@getpaseo/brain/host";
import { setTimeout as delay } from "node:timers/promises";

interface LogDemand {
  includeLogs: boolean;
  afterLogIndex: number | null;
  instanceId: string | null;
}

interface Lease {
  abort: AbortController;
  release(): void;
  timer: ReturnType<typeof setTimeout>;
  waiting: boolean;
}
export class BrainStatusLeases<Status extends { instanceId: string }> {
  private readonly clients = new Map<string, Map<string, Lease>>();
  private count = 0;
  constructor(private readonly store: BrainStatusStore<Status>) {}
  async wait(clientId: string, leaseId: string, cursor: string | null, logs?: LogDemand) {
    if (!clientId) throw new Error("A Brain subscription requires an authenticated client session");
    let leases = this.clients.get(clientId);
    let lease = leases?.get(leaseId);
    if (!lease) {
      if (this.count >= 64 || (leases?.size ?? 0) >= 4)
        throw new Error("Too many Brain subscriptions");
      leases ??= new Map();
      this.clients.set(clientId, leases);
      const release = this.store.retain();
      lease = {
        abort: new AbortController(),
        release,
        waiting: false,
        timer: setTimeout(() => this.release(clientId, leaseId), 30000),
      };
      lease.timer.unref();
      leases.set(leaseId, lease);
      this.count++;
    }
    if (lease.waiting) throw new Error("A Brain subscription already has a pending wait");
    clearTimeout(lease.timer);
    lease.timer = setTimeout(() => this.release(clientId, leaseId), 30000);
    lease.timer.unref();
    lease.waiting = true;
    try {
      const snapshot = await this.store.wait(
        cursor,
        lease.abort.signal,
        20000,
        logs?.includeLogs ?? true,
      );
      if (!logs?.includeLogs) return snapshot;
      // Log bursts are delivered in bounded batches, never one RPC per emitted line.
      await delay(100, undefined, { signal: lease.abort.signal });
      const current = this.store.getSnapshot();
      const sameOwner = current.status?.instanceId === logs.instanceId;
      const after =
        sameOwner && logs.afterLogIndex !== null && logs.afterLogIndex <= current.nextLogIndex
          ? logs.afterLogIndex
          : null;
      return {
        ...current,
        logs: current.logs.filter((line) => after === null || line.index >= after),
      };
    } finally {
      lease.waiting = false;
    }
  }
  release(clientId: string, leaseId: string): void {
    const leases = this.clients.get(clientId);
    const lease = leases?.get(leaseId);
    if (!lease) return;
    leases!.delete(leaseId);
    if (!leases!.size) this.clients.delete(clientId);
    this.count--;
    clearTimeout(lease.timer);
    lease.abort.abort();
    lease.release();
  }
  releaseClient(clientId: string): void {
    const leases = this.clients.get(clientId);
    if (leases) for (const id of leases.keys()) this.release(clientId, id);
  }
  close(): void {
    for (const clientId of this.clients.keys()) this.releaseClient(clientId);
  }
}
