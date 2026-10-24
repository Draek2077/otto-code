/** Shared per-installation projection. Screens, settings and the icon borrow the same feed. */
import {
  BrainBootstrapSchema,
  BrainConnectionReadSchema,
  BrainStatusReadSchema,
  type BrainConnectionRead,
  type BrainOwnerRead,
} from "@getpaseo/protocol/otto/brain";
import { z } from "zod";
import { BrainRpc } from "./rpc";
import { BrainSettingsOperationError, type BrainSettingsPort } from "../settings/contracts";

export interface BrainConnectionStateSnapshot {
  connection: BrainConnectionRead | null;
  owner: BrainOwnerRead | null;
  ownerError: string | null;
  feed: z.infer<typeof BrainStatusReadSchema> | null;
  localRunning: boolean;
  endpoint: string | null;
  loading: boolean;
  connected: boolean;
  error: Error | null;
}
interface FeedSession {
  id: string;
  released: boolean;
}
type Feed = z.infer<typeof BrainStatusReadSchema>;
function mergeBrainLogs(previous: Feed, next: Feed): Feed {
  const lines = new Map(
    previous.logs
      .filter((line) => line.index >= next.firstLogIndex)
      .map((line) => [line.index, line]),
  );
  for (const line of next.logs) lines.set(line.index, line);
  const logs = [...lines.values()].sort((left, right) => left.index - right.index);
  const encoder = new TextEncoder();
  let bytes = logs.reduce((total, line) => total + encoder.encode(line.line).length, 0);
  while (logs.length > 1000 || bytes > 1024 * 1024) {
    const removed = logs.shift();
    if (removed) bytes -= encoder.encode(removed.line).length;
  }
  return { ...next, logs, firstLogIndex: logs[0]?.index ?? next.nextLogIndex };
}
export class BrainConnectionState {
  private snapshot: BrainConnectionStateSnapshot = {
    connection: null,
    owner: null,
    ownerError: null,
    feed: null,
    localRunning: false,
    endpoint: null,
    loading: false,
    connected: false,
    error: null,
  };
  private readonly listeners = new Set<() => void>();
  private demand = 0;
  private logDemand = 0;
  private generation = 0;
  private closed = false;
  private session: FeedSession | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private loading: Promise<void> | null = null;
  private metadataEpoch = 0;
  constructor(
    readonly rpc: BrainRpc,
    private readonly makeLease: () => string = () => globalThis.crypto.randomUUID(),
  ) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<BrainConnectionStateSnapshot>): void {
    if (this.closed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  retain = (): (() => void) => {
    if (this.closed) throw new Error("Brain app connection is closed");
    if (++this.demand === 1) {
      void this.refresh();
      this.openFeed();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.demand === 0) this.releaseFeed();
    };
  };
  retainLogs = (): (() => void) => {
    if (++this.logDemand === 1 && this.demand > 0) this.restartFeed();
    const releaseStatus = this.retain();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseStatus();
      if (--this.logDemand === 0 && this.demand > 0) this.restartFeed();
    };
  };
  private restartFeed(): void {
    this.releaseFeed();
    this.openFeed();
  }
  async refresh(): Promise<void> {
    if (this.closed) throw new Error("Brain app connection is closed");
    if (this.loading) return this.loading;
    this.publish({ loading: true });
    this.loading = this.load().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }
  private async load(): Promise<void> {
    const epoch = this.metadataEpoch;
    try {
      const data = await this.rpc.request("brain.bootstrap", {}, BrainBootstrapSchema);
      if (epoch !== this.metadataEpoch) return;
      this.publish({ ...data, loading: false, connected: true, error: null });
    } catch (error) {
      if (epoch !== this.metadataEpoch) return;
      this.publish({
        loading: false,
        connected: false,
        error: error instanceof Error ? error : new Error("Brain settings could not be read"),
      });
    }
  }
  async readConnection() {
    const epoch = ++this.metadataEpoch;
    let connection: BrainConnectionRead;
    try {
      connection = await this.rpc.request("brain.connection.read", {}, BrainConnectionReadSchema);
    } catch (error) {
      this.publish({ loading: false });
      throw error;
    }
    if (epoch !== this.metadataEpoch)
      throw new BrainSettingsOperationError(
        "conflict",
        "The Brain connection changed during this read. Reload its settings.",
      );
    const changed = this.snapshot.connection?.revision !== connection.revision;
    this.publish({
      connection,
      connected: true,
      error: null,
      loading: false,
      ...(changed ? { owner: null, ownerError: null, feed: null } : {}),
    });
    return connection;
  }
  async saveConnection(input: Parameters<BrainSettingsPort["saveConnection"]>[0]) {
    this.metadataEpoch++;
    let connection: BrainConnectionRead;
    try {
      connection = await this.rpc.request(
        "brain.connection.save",
        input,
        BrainConnectionReadSchema,
      );
    } catch (error) {
      this.publish({ loading: false });
      throw error;
    }
    // Publish the accepted connection, then read the actual selected owner, never reuse the old one.
    this.metadataEpoch++;
    this.publish({
      connection,
      owner: null,
      ownerError: null,
      feed: null,
      connected: true,
      loading: false,
    });
    await this.loading;
    await this.refresh();
    return connection;
  }
  acceptOwner(owner: BrainOwnerRead, connectionRevision: string): void {
    if (this.snapshot.connection?.revision !== connectionRevision)
      throw new BrainSettingsOperationError(
        "conflict",
        "The selected Brain connection changed. Reload its settings before continuing.",
      );
    this.metadataEpoch++;
    this.publish({ owner, ownerError: null, connected: true, error: null, loading: false });
  }
  private current(generation: number): boolean {
    return !this.closed && this.demand > 0 && generation === this.generation;
  }
  private openFeed(): void {
    if (this.closed || !this.demand || this.session || this.retry) return;
    const generation = ++this.generation;
    const session = { id: this.makeLease(), released: false };
    this.session = session;
    void this.follow(generation, session);
  }
  private waitInput(session: FeedSession, cursor: string | null, includeLogs: boolean) {
    return {
      leaseId: session.id,
      cursor,
      includeLogs,
      afterLogIndex:
        includeLogs && this.snapshot.feed?.logs.length ? this.snapshot.feed.nextLogIndex : null,
      instanceId: this.snapshot.feed?.status?.instanceId ?? null,
    };
  }
  private acceptFeed(feed: Feed, includeLogs: boolean): void {
    const previous = this.snapshot.feed;
    const changedOwner = !previous || previous.status?.instanceId !== feed.status?.instanceId;
    const changedConnection = this.snapshot.connection?.revision !== feed.controlRevision;
    const changedSettings =
      previous?.status?.ownerSettingsRevision !== feed.status?.ownerSettingsRevision;
    const interrupted = previous?.connection === "connected" && feed.connection !== "connected";
    const projected =
      includeLogs && previous && !changedOwner ? mergeBrainLogs(previous, feed) : feed;
    this.publish({ feed: projected, connected: true, error: null });
    if (changedOwner || changedConnection || changedSettings || interrupted) void this.refresh();
  }
  private async follow(generation: number, session: FeedSession): Promise<void> {
    let cursor: string | null = null;
    const includeLogs = this.logDemand > 0;
    try {
      while (this.current(generation)) {
        const feed: z.infer<typeof BrainStatusReadSchema> = await this.rpc.request(
          "brain.status.wait",
          this.waitInput(session, cursor, includeLogs),
          BrainStatusReadSchema,
        );
        if (!this.current(generation)) return;
        cursor = feed.cursor;
        this.acceptFeed(feed, includeLogs);
      }
    } catch (error) {
      if (this.current(generation))
        this.publish({
          connected: false,
          feed: null,
          error: error instanceof Error ? error : new Error("The Brain connection ended"),
        });
    } finally {
      await this.releaseLease(session);
      if (this.session === session) this.session = null;
      if (this.current(generation)) {
        this.retry = setTimeout(() => {
          this.retry = null;
          this.openFeed();
        }, 3000);
      }
    }
  }
  private async releaseLease(session: FeedSession): Promise<void> {
    if (session.released) return;
    session.released = true;
    try {
      await this.rpc.request(
        "brain.status.release",
        { leaseId: session.id },
        BrainConnectionState.releasedSchema,
      );
    } catch {
      /* The daemon also releases the lease when this paired session disconnects. */
    }
  }
  private static readonly releasedSchema = z.object({ released: z.literal(true) });
  private releaseFeed(): void {
    this.generation++;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const session = this.session;
    this.session = null;
    if (session) void this.releaseLease(session);
  }
  close(): void {
    this.closed = true;
    this.releaseFeed();
    this.listeners.clear();
  }
}
