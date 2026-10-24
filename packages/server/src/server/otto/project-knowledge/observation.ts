import path from "node:path";
import { lstat, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  createFileObserver,
  type FileObserver,
  type FileObserverSubscription,
} from "../../file-observer/index.js";
import { hasCode, type KnowledgeStore } from "./store-resolver.js";

/** Observe the nearest existing store ancestor, pruning every unrelated subtree.
 * This also sees an external first `.otto` creation without walking the project. */
export async function knowledgeObservationPlan(store: KnowledgeStore) {
  const relative = path.relative(store.boundary, store.base);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error("Knowledge observation escapes its owning boundary");
  const segments = relative.split(path.sep).filter(Boolean);
  let root = store.boundary;
  for (const segment of segments) {
    const child = path.join(root, segment);
    try {
      const info = await lstat(child);
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new Error("Knowledge observation cannot follow links or non-directories");
      root = child;
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
      break;
    }
  }
  const next = path.relative(root, store.base).split(path.sep)[0];
  const allowed = new Set(root === store.base ? ["knowledge", "KNOWLEDGE.md"] : [next]);
  const ignore = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => !allowed.has(entry.name))
    .map((entry) => path.join(root, entry.name));
  return { root, ignore };
}

interface Feed {
  projectId: string;
  cursor: string;
  error: string | null;
  leases: Set<string>;
  wake: Set<() => void>;
  subscription: FileObserverSubscription | null;
  root: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  work: Promise<void>;
  closed: boolean;
}
interface Lease {
  key: string;
  clientId: string;
  feed: Feed;
  waiting: boolean;
  timer: ReturnType<typeof setTimeout>;
  wake: (() => void) | null;
}

/** One pruned Paseo observer per demanded project, shared by all paired sessions.
 * RPC timeouts are heartbeats only; filesystem reads are event-driven. */
export class KnowledgeObservations {
  private readonly feeds = new Map<string, Feed>();
  private readonly leases = new Map<string, Lease>();
  private observer: FileObserver | null = null;
  private closed = false;
  constructor(
    private readonly ports: {
      resolve(projectId: string): Promise<KnowledgeStore>;
      createObserver?: () => FileObserver;
    },
  ) {}

  async wait(clientId: string, leaseId: string, projectId: string, cursor: string | null) {
    if (this.closed || !clientId)
      throw new Error("Knowledge observation requires a live paired session");
    const key = JSON.stringify([clientId, leaseId]);
    let lease = this.leases.get(key);
    if (lease && lease.feed.projectId !== projectId)
      throw new Error("Knowledge lease changed project");
    if (!lease) lease = this.retain(key, clientId, projectId);
    if (lease.waiting) throw new Error("Knowledge lease already has a pending wait");
    lease.waiting = true;
    clearTimeout(lease.timer);
    lease.timer = this.expiry(key);
    const feed = lease.feed;
    try {
      await feed.work;
      if (this.leases.get(key) !== lease) throw new Error("Knowledge observation was released");
      if (cursor === feed.cursor && !feed.error) await this.changed(lease);
      if (this.leases.get(key) !== lease) throw new Error("Knowledge observation was released");
      return { cursor: feed.cursor, error: feed.error };
    } finally {
      lease.waiting = false;
    }
  }
  private retain(key: string, clientId: string, projectId: string): Lease {
    const clientCount = [...this.leases.values()].filter(
      (lease) => lease.clientId === clientId,
    ).length;
    if (this.leases.size >= 64 || clientCount >= 8)
      throw new Error("Too many Knowledge subscriptions");
    let feed = this.feeds.get(projectId);
    if (!feed) {
      feed = {
        projectId,
        cursor: randomUUID(),
        error: null,
        leases: new Set(),
        wake: new Set(),
        subscription: null,
        root: null,
        timer: null,
        work: Promise.resolve(),
        closed: false,
      };
      this.feeds.set(projectId, feed);
      this.queueReconcile(feed);
    }
    const lease: Lease = {
      key,
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
  private expiry(key: string) {
    const timer = setTimeout(() => {
      void this.releaseKey(key).catch(() => undefined);
    }, 30000);
    timer.unref();
    return timer;
  }
  private changed(lease: Lease): Promise<void> {
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    let done = false;
    const wake = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      lease.feed.wake.delete(wake);
      lease.wake = null;
      complete();
    };
    const timer = setTimeout(wake, 20000);
    timer.unref();
    lease.wake = wake;
    lease.feed.wake.add(wake);
    return pending;
  }
  notify(projectId: string): void {
    const feed = this.feeds.get(projectId);
    if (!feed || feed.closed) return;
    this.bump(feed);
    this.queueReconcile(feed);
  }
  private bump(feed: Feed): void {
    feed.cursor = randomUUID();
    for (const wake of feed.wake) wake();
  }
  private schedule(feed: Feed): void {
    if (feed.closed) return;
    if (feed.timer) clearTimeout(feed.timer);
    feed.timer = setTimeout(() => {
      feed.timer = null;
      this.bump(feed);
      this.queueReconcile(feed);
    }, 150);
    feed.timer.unref();
  }
  private queueReconcile(feed: Feed): void {
    feed.work = feed.work
      .then(() => this.reconcile(feed))
      .catch(() => {
        if (feed.closed) return;
        feed.error =
          "External Knowledge refresh is unavailable. Refresh manually or reopen this page to reconnect.";
        this.bump(feed);
      });
  }
  private async reconcile(feed: Feed): Promise<void> {
    if (feed.closed) return;
    const store = await this.ports.resolve(feed.projectId);
    const plan = await knowledgeObservationPlan(store);
    if (feed.closed) return;
    if (feed.subscription && feed.root === plan.root) {
      await feed.subscription.updateIgnore(plan.ignore);
      return;
    }
    await feed.subscription?.unsubscribe();
    feed.subscription = null;
    if (feed.closed) return;
    this.observer ??= (this.ports.createObserver ?? createFileObserver)();
    const subscription = await this.observer.subscribe(
      plan.root,
      (error, events) => {
        if (feed.closed) return;
        if (error) {
          feed.error =
            "External Knowledge refresh is unavailable. Refresh manually or reopen this page to reconnect.";
          this.bump(feed);
        } else if (events.length) this.schedule(feed);
      },
      { ignore: plan.ignore },
    );
    if (feed.closed) await subscription.unsubscribe();
    else {
      feed.subscription = subscription;
      feed.root = plan.root;
    }
  }
  async release(clientId: string, leaseId: string): Promise<void> {
    await this.releaseKey(JSON.stringify([clientId, leaseId]));
  }
  private async releaseKey(key: string): Promise<void> {
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
    this.feeds.delete(feed.projectId);
    await feed.work;
    await feed.subscription?.unsubscribe();
  }
  async releaseClient(clientId: string): Promise<void> {
    await Promise.all(
      [...this.leases.values()]
        .filter((lease) => lease.clientId === clientId)
        .map((lease) => this.releaseKey(lease.key)),
    );
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.leases.keys()].map((key) => this.releaseKey(key)));
    await this.observer?.close();
    this.observer = null;
  }
}
