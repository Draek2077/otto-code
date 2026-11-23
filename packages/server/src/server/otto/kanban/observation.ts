import { createHash, randomUUID } from "node:crypto";
import type { BoardRead, ProjectBinding } from "@getpaseo/plugin/otto/kanban";

export const KANBAN_POLL_INTERVAL_MS = 30_000;
const HEARTBEAT_MS = 20_000;
const LEASE_MS = 35_000;
interface Feed {
  binding: ProjectBinding;
  cursor: string;
  digest: string | null;
  leases: Set<string>;
  wake: Set<() => void>;
  work: Promise<void>;
  timer: ReturnType<typeof setTimeout> | null;
  failures: number;
  closed: boolean;
}
interface Lease {
  clientId: string;
  feed: Feed;
  waiting: boolean;
  wake: (() => void) | null;
  timer: ReturnType<typeof setTimeout>;
}

/** Demand-owned polling, not a webhook or a second board cache. Only digests
 * and invalidation cursors survive a provider read. All viewers share one read. */
export class KanbanObservations {
  private readonly feeds = new Map<string, Feed>();
  private readonly leases = new Map<string, Lease>();
  private closed = false;
  constructor(private readonly read: (binding: ProjectBinding) => Promise<BoardRead>) {}

  async wait(clientId: string, leaseId: string, binding: ProjectBinding, cursor: string | null) {
    if (this.closed || !clientId) throw new Error("A live paired session is required");
    const key = JSON.stringify([clientId, leaseId]);
    let lease = this.leases.get(key);
    if (
      lease &&
      (lease.feed.binding.hostId !== binding.hostId ||
        lease.feed.binding.projectId !== binding.projectId)
    )
      throw new Error("The board subscription changed project");
    if (!lease) lease = this.retain(key, clientId, binding);
    if (lease.waiting) throw new Error("The board subscription already has a pending wait");
    lease.waiting = true;
    clearTimeout(lease.timer);
    lease.timer = this.expiry(key);
    try {
      await lease.feed.work;
      if (this.leases.get(key) !== lease) throw new Error("The board subscription was released");
      if (cursor === lease.feed.cursor) await this.changed(lease);
      if (this.leases.get(key) !== lease) throw new Error("The board subscription was released");
      return { cursor: lease.feed.cursor };
    } finally {
      lease.waiting = false;
    }
  }
  private retain(key: string, clientId: string, binding: ProjectBinding): Lease {
    const count = [...this.leases.values()].filter((entry) => entry.clientId === clientId).length;
    if (this.leases.size >= 64 || count >= 8) throw new Error("Too many board subscriptions");
    const identity = JSON.stringify([binding.hostId, binding.projectId]);
    let feed = this.feeds.get(identity);
    if (!feed) {
      feed = {
        binding: { hostId: binding.hostId, projectId: binding.projectId },
        cursor: randomUUID(),
        digest: null,
        leases: new Set(),
        wake: new Set(),
        work: Promise.resolve(),
        timer: null,
        failures: 0,
        closed: false,
      };
      this.feeds.set(identity, feed);
      this.poll(feed);
    }
    const lease: Lease = {
      clientId,
      feed,
      waiting: false,
      wake: null,
      timer: this.expiry(key),
    };
    feed.leases.add(key);
    this.leases.set(key, lease);
    return lease;
  }
  private poll(feed: Feed) {
    feed.work = this.sample(feed).finally(() => {
      if (feed.closed || this.closed) return;
      // Provider errors back off; a successful read returns to the ordinary cadence.
      const delay = Math.min(300_000, KANBAN_POLL_INTERVAL_MS * 2 ** feed.failures);
      feed.timer = setTimeout(() => this.poll(feed), delay);
      feed.timer.unref();
    });
  }
  private async sample(feed: Feed) {
    let digest: string;
    try {
      const result = await this.read(feed.binding);
      // Hash the complete normalized read: GitHub's project updatedAt is not
      // guaranteed to change when an underlying issue's title/body changes.
      digest = createHash("sha256").update(JSON.stringify(result)).digest("hex");
      feed.failures = result.status === "error" ? Math.min(feed.failures + 1, 4) : 0;
    } catch {
      digest = "unavailable";
      feed.failures = Math.min(feed.failures + 1, 4);
    }
    if (feed.closed || this.closed || digest === feed.digest) return;
    feed.digest = digest;
    feed.cursor = randomUUID();
    for (const wake of feed.wake) wake();
  }
  private expiry(key: string) {
    const timer = setTimeout(() => this.releaseKey(key), LEASE_MS);
    timer.unref();
    return timer;
  }
  private changed(lease: Lease): Promise<void> {
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    let settled = false;
    const wake = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lease.feed.wake.delete(wake);
      lease.wake = null;
      complete();
    };
    const timer = setTimeout(wake, HEARTBEAT_MS);
    timer.unref();
    lease.wake = wake;
    lease.feed.wake.add(wake);
    return pending;
  }
  release(clientId: string, leaseId: string) {
    this.releaseKey(JSON.stringify([clientId, leaseId]));
  }
  releaseClient(clientId: string) {
    for (const [key, lease] of this.leases) if (lease.clientId === clientId) this.releaseKey(key);
  }
  private releaseKey(key: string) {
    const lease = this.leases.get(key);
    if (!lease) return;
    this.leases.delete(key);
    clearTimeout(lease.timer);
    lease.wake?.();
    const feed = lease.feed;
    feed.leases.delete(key);
    if (feed.leases.size) return;
    feed.closed = true;
    if (feed.timer) clearTimeout(feed.timer);
    this.feeds.delete(JSON.stringify([feed.binding.hostId, feed.binding.projectId]));
  }
  async close() {
    this.closed = true;
    const work = [...this.feeds.values()].map((feed) => feed.work);
    for (const key of this.leases.keys()) this.releaseKey(key);
    await Promise.allSettled(work);
  }
}
