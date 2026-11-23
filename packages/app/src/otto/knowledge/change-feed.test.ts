import { afterEach, expect, it, vi } from "vitest";
import { KnowledgeChangeFeed } from "./change-feed";
afterEach(() => vi.useRealTimers());
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const reads: ReturnType<typeof deferred<{ cursor: string; error: string | null }>>[] = [];
  const wait = vi.fn(async () => {
    const read = deferred<{ cursor: string; error: string | null }>();
    reads.push(read);
    return read.promise;
  });
  const release = vi.fn(async () => {});
  const changed = vi.fn();
  const unused = vi.fn();
  const feed = new KnowledgeChangeFeed({
    wait,
    release,
    changed,
    unused,
    makeId: () => "fixture-lease",
  });
  return { feed, reads, wait, release, changed, unused };
}
it("shares one wait across consumers, refreshes on reconnect and ignores heartbeats", async () => {
  const f = fixture();
  const a = f.feed.retain();
  const b = f.feed.retain();
  expect(f.wait).toHaveBeenCalledOnce();
  f.reads[0].resolve({ cursor: "one", error: null });
  await vi.waitFor(() => expect(f.reads).toHaveLength(2));
  expect(f.changed).toHaveBeenCalledOnce();
  f.reads[1].resolve({ cursor: "one", error: null });
  await vi.waitFor(() => expect(f.reads).toHaveLength(3));
  expect(f.changed).toHaveBeenCalledOnce();
  a();
  a();
  expect(f.release).not.toHaveBeenCalled();
  f.reads[2].resolve({ cursor: "two", error: null });
  await vi.waitFor(() => expect(f.changed).toHaveBeenCalledTimes(2));
  b();
  expect(f.unused).toHaveBeenCalledOnce();
  expect(f.release).toHaveBeenCalledWith("fixture-lease");
  f.reads[3].resolve({ cursor: "late", error: null });
  await vi.waitFor(() => expect(f.release).toHaveBeenCalledTimes(2));
  expect(f.changed).toHaveBeenCalledTimes(2);
});
it("surfaces safe refresh errors, reconnects once and cancels reconnect while hidden", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const close = f.feed.retain();
  f.reads[0].reject(new Error("private transport details"));
  await vi.advanceTimersByTimeAsync(0);
  expect(f.feed.getSnapshot()).toContain("disconnected");
  expect(f.feed.getSnapshot()).not.toContain("private");
  await vi.advanceTimersByTimeAsync(3000);
  expect(f.reads).toHaveLength(2);
  f.reads[1].resolve({ cursor: "fresh", error: null });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.feed.getSnapshot()).toBeNull();
  close();
  f.reads[2].reject(new Error("closed"));
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.reads).toHaveLength(3);
});
