import { afterEach, expect, it, vi } from "vitest";
import { BrainStatusStore, type BrainStatusSource } from "./status-store.js";
interface Status {
  instanceId: string;
  state: string;
}
function record(index: number, line: string, instanceId = "owner-a") {
  return { index, line, instanceId };
}
const stores: BrainStatusStore<Status>[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  vi.useRealTimers();
});
function fixture(limits: { maxLogLines?: number; maxLogBytes?: number } = {}) {
  const sessions: Array<{
    receive: Parameters<BrainStatusSource<Status>["open"]>[0];
    signal: AbortSignal;
    end(): void;
    fail(error: Error): void;
  }> = [];
  const source: BrainStatusSource<Status> = {
    open: (receive, signal) =>
      new Promise<void>((resolve, reject) => {
        sessions.push({ receive, signal, end: resolve, fail: reject });
        signal.addEventListener("abort", () => resolve(), { once: true });
        if (signal.aborted) resolve();
      }),
  };
  const store = new BrainStatusStore(source, { streamId: "fixture-stream", ...limits });
  stores.push(store);
  return { store, sessions };
}
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
it("keeps status-only consumers asleep through log bursts and never returns retained logs to them", async () => {
  const f = fixture();
  const release = f.store.retain();
  await tick();
  f.sessions[0]!.receive.status({ instanceId: "owner-a", state: "ready" });
  const first = await f.store.wait(null, new AbortController().signal, 20000, false);
  let settled = false;
  const waiting = f.store
    .wait(first.cursor, new AbortController().signal, 20000, false)
    .then((value) => {
      settled = true;
      return value;
    });
  for (let index = 0; index < 20; index++)
    f.sessions[0]!.receive.log(record(index, `line ${index}`));
  await tick();
  expect(settled).toBe(false);
  f.sessions[0]!.receive.status({ instanceId: "owner-a", state: "stopped" });
  expect(await waiting).toMatchObject({ status: { state: "stopped" }, logs: [] });
  expect(f.store.getSnapshot().logs).toHaveLength(20);
  release();
});

it("invalidates an explicitly changed connection without accepting old owner callbacks", async () => {
  const f = fixture();
  const release = f.store.retain();
  await tick();
  const old = f.sessions[0]!;
  old.receive.status({ instanceId: "owner-a", state: "ready" });
  old.receive.log(record(0, "old log"));
  const cursor = f.store.getSnapshot().cursor;
  f.store.invalidate();
  expect(old.signal.aborted).toBe(true);
  expect(f.store.getSnapshot()).toMatchObject({ status: null, logs: [], connection: "connecting" });
  expect(f.store.getSnapshot().cursor).not.toBe(cursor);
  old.receive.status({ instanceId: "owner-a", state: "stale" });
  old.receive.log(record(1, "late old log"));
  expect(f.store.getSnapshot().status).toBeNull();
  await tick();
  expect(f.sessions).toHaveLength(2);
  f.sessions[1]!.receive.status({ instanceId: "owner-b", state: "stopped" });
  expect(f.store.getSnapshot().status?.instanceId).toBe("owner-b");
  expect(f.store.getSnapshot().logs).toEqual([]);
  release();
});

it("invalidating a passive store creates no feed demand", async () => {
  const f = fixture();
  f.store.invalidate();
  await tick();
  expect(f.sessions).toHaveLength(0);
  expect(f.store.getSnapshot().connection).toBe("disconnected");
});

it("keeps passive reads, subscriptions and immediate waits free of host demand", async () => {
  const f = fixture();
  const snapshot = f.store.getSnapshot();
  const unsubscribe = f.store.subscribe(() => {});
  expect(await f.store.wait(null, new AbortController().signal)).toBe(snapshot);
  await tick();
  expect(f.sessions).toHaveLength(0);
  expect(f.store.getSnapshot()).toBe(snapshot);
  unsubscribe();
});

it("shares exactly one source across retained consumers and releases only at zero demand", async () => {
  const f = fixture();
  const first = f.store.retain();
  const second = f.store.retain();
  await tick();
  expect(f.sessions).toHaveLength(1);
  f.sessions[0]!.receive.status({ instanceId: "owner-a", state: "ready" });
  first();
  first();
  expect(f.sessions[0]!.signal.aborted).toBe(false);
  second();
  expect(f.sessions[0]!.signal.aborted).toBe(true);
  await tick();
  expect(f.store.getSnapshot().connection).toBe("disconnected");
});

it("does not open a feed for demand released before connection begins", async () => {
  const f = fixture();
  f.store.retain()();
  await tick();
  expect(f.sessions).toHaveLength(0);
});

it("wakes a bounded wait on new data and retains snapshot identity between changes", async () => {
  const f = fixture();
  const release = f.store.retain();
  await tick();
  const origin = f.store.getSnapshot();
  const pending = f.store.wait(origin.cursor, new AbortController().signal);
  const input = { instanceId: "owner-a", state: "ready" };
  f.sessions[0]!.receive.status(input);
  const next = await pending;
  input.state = "mutated-source";
  expect(next.status?.state).toBe("ready");
  expect(next).toBe(f.store.getSnapshot());
  expect(next.cursor).not.toBe(origin.cursor);
  release();
});

it("returns the same snapshot on a normal wait deadline without creating demand", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const origin = f.store.getSnapshot();
  const pending = f.store.wait(origin.cursor, new AbortController().signal, 50);
  await vi.advanceTimersByTimeAsync(50);
  expect(await pending).toBe(origin);
  expect(f.sessions).toHaveLength(0);
});

it("removes canceled waiters and rejects closed-store waits", async () => {
  const f = fixture();
  const signal = new AbortController();
  const pending = f.store.wait(f.store.getSnapshot().cursor, signal.signal);
  const rejected = expect(pending).rejects.toThrow("canceled");
  signal.abort();
  await rejected;
  const closing = f.store.wait(f.store.getSnapshot().cursor, new AbortController().signal);
  const closed = expect(closing).rejects.toThrow("closed");
  await f.store.close();
  await closed;
  await expect(f.store.wait(null, new AbortController().signal)).rejects.toThrow("closed");
});

it("rejects excessive waiters and releases every pending wait during close", async () => {
  const f = fixture();
  const pending = Array.from({ length: 64 }, () =>
    f.store
      .wait(f.store.getSnapshot().cursor, new AbortController().signal)
      .catch((error: Error) => error.message),
  );
  await expect(
    f.store.wait(f.store.getSnapshot().cursor, new AbortController().signal),
  ).rejects.toThrow("Too many");
  await f.store.close();
  expect(await Promise.all(pending)).toEqual(Array(64).fill("Brain status store is closed"));
});

it("bounds logs by lines and bytes while keeping absolute indices", async () => {
  const f = fixture({ maxLogLines: 2, maxLogBytes: 8 });
  const release = f.store.retain();
  await tick();
  const feed = f.sessions[0]!.receive;
  feed.status({ instanceId: "owner-a", state: "ready" });
  feed.log(record(0, "aaaa"));
  feed.log(record(1, "bbbb"));
  feed.log(record(2, "cccc"));
  expect(f.store.getSnapshot()).toMatchObject({
    firstLogIndex: 1,
    nextLogIndex: 3,
    logs: [
      { index: 1, line: "bbbb" },
      { index: 2, line: "cccc" },
    ],
  });
  feed.log(record(3, "😀😀😀"));
  expect(f.store.getSnapshot()).toMatchObject({
    firstLogIndex: 3,
    nextLogIndex: 4,
    logs: [{ index: 3, line: "😀😀" }],
  });
  release();
});

it("resets the log epoch only when the authoritative host lifetime changes", async () => {
  const f = fixture();
  const release = f.store.retain();
  await tick();
  const feed = f.sessions[0]!.receive;
  feed.status({ instanceId: "owner-a", state: "ready" });
  feed.log(record(0, "old owner's line"));
  feed.status({ instanceId: "owner-a", state: "ready" });
  expect(f.store.getSnapshot().logs).toHaveLength(1);
  feed.status({ instanceId: "owner-b", state: "stopped" });
  expect(f.store.getSnapshot()).toMatchObject({ logs: [], firstLogIndex: 0, nextLogIndex: 0 });
  release();
});

it("invalidates stale source callbacks across release and reactivation", async () => {
  const f = fixture();
  const first = f.store.retain();
  await tick();
  first();
  const release = f.store.retain();
  await tick();
  await tick();
  expect(f.sessions).toHaveLength(2);
  f.sessions[1]!.receive.status({ instanceId: "owner-new", state: "ready" });
  const current = f.store.getSnapshot();
  f.sessions[0]!.receive.status({ instanceId: "owner-old", state: "failed" });
  f.sessions[0]!.receive.log(record(0, "stale line", "owner-old"));
  expect(f.store.getSnapshot()).toBe(current);
  release();
});

it("holds bounded pre-status logs until their authoritative owner is known", async () => {
  const f = fixture({ maxLogLines: 2 });
  const release = f.store.retain();
  await tick();
  const feed = f.sessions[0]!.receive;
  feed.log(record(0, "discarded before buffer start"));
  feed.log(record(1, "current owner evidence"));
  feed.log(record(2, "newest owner evidence"));
  expect(f.store.getSnapshot().logs).toEqual([]);
  feed.status({ instanceId: "owner-a", state: "ready" });
  expect(f.store.getSnapshot()).toMatchObject({
    firstLogIndex: 1,
    nextLogIndex: 3,
    logs: [
      { index: 1, line: "current owner evidence" },
      { index: 2, line: "newest owner evidence" },
    ],
  });
  feed.log(record(0, "other owner's line", "owner-b"));
  expect(f.store.getSnapshot().logs).toHaveLength(2);
  feed.status({ instanceId: "owner-b", state: "ready" });
  expect(f.store.getSnapshot().logs).toEqual([{ index: 0, line: "other owner's line" }]);
  release();
});

it("deduplicates host-indexed replay and marks gaps through an honest new buffer start", async () => {
  const f = fixture();
  const release = f.store.retain();
  await tick();
  const feed = f.sessions[0]!.receive;
  feed.status({ instanceId: "owner-a", state: "ready" });
  feed.log(record(0, "same message"));
  const first = f.store.getSnapshot();
  feed.log(record(0, "same message"));
  expect(f.store.getSnapshot()).toBe(first);
  feed.log(record(1, "same message"));
  expect(f.store.getSnapshot().logs).toHaveLength(2);
  feed.log(record(8, "later after an unavailable interval"));
  expect(f.store.getSnapshot()).toMatchObject({
    firstLogIndex: 8,
    nextLogIndex: 9,
    logs: [{ index: 8, line: "later after an unavailable interval" }],
  });
  release();
});

it("reconnects with bounded backoff and never exposes raw source errors", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const release = f.store.retain();
  await tick();
  f.sessions[0]!.fail(new Error("private-token-owner-path"));
  await tick();
  expect(JSON.stringify(f.store.getSnapshot())).not.toContain("private-token");
  await vi.advanceTimersByTimeAsync(249);
  expect(f.sessions).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.sessions).toHaveLength(2);
  f.sessions[1]!.end();
  await tick();
  await vi.advanceTimersByTimeAsync(499);
  expect(f.sessions).toHaveLength(2);
  release();
  await vi.advanceTimersByTimeAsync(15000);
  expect(f.sessions).toHaveLength(2);
});

it("cannot be revived by late release, status or retry after close", async () => {
  const f = fixture();
  const release = f.store.retain();
  await tick();
  await f.store.close();
  const closed = f.store.getSnapshot();
  release();
  f.sessions[0]!.receive.status({ instanceId: "late-owner", state: "ready" });
  expect(f.store.getSnapshot()).toBe(closed);
  expect(() => f.store.retain()).toThrow("closed");
});
