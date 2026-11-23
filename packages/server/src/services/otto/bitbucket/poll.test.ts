import { afterEach, expect, it, vi } from "vitest";
import { createBitbucketPoller } from "./poll.js";
afterEach(() => vi.useRealTimers());
it("shares one sequential read and stops with the last consumer", async () => {
  vi.useFakeTimers();
  let reads = 0;
  const received: string[] = [];
  const poller = createBitbucketPoller(async () => {
    reads++;
    return null;
  });
  const first = poller.retain({
    cwd: "/repo",
    headRef: "main",
    onStatus: () => received.push("first"),
  });
  const second = poller.retain({
    cwd: "/repo",
    headRef: "main",
    onStatus: () => received.push("second"),
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(reads).toBe(1);
  expect(received).toEqual(["first", "second"]);
  first.unsubscribe();
  await vi.advanceTimersByTimeAsync(180_000);
  expect(reads).toBe(2);
  expect(received).toEqual(["first", "second", "second"]);
  second.unsubscribe();
  await vi.advanceTimersByTimeAsync(180_000);
  expect(reads).toBe(2);
});
it("invalidates pending authority when the account changes and refreshes without overlap", async () => {
  vi.useFakeTimers();
  const completed: null[] = [];
  let finish: () => void = () => {
    throw new Error("No pending read");
  };
  let reads = 0;
  const poller = createBitbucketPoller(async () => {
    reads++;
    if (reads === 1)
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return null;
  });
  const release = poller.retain({
    cwd: "/repo",
    headRef: "main",
    onStatus: (value) => {
      expect(value).toBeNull();
      completed.push(null);
    },
  });
  await vi.advanceTimersByTimeAsync(0);
  poller.invalidate();
  expect(reads).toBe(1);
  finish();
  await vi.advanceTimersByTimeAsync(1);
  expect(reads).toBe(2);
  expect(completed).toEqual([null]);
  release.unsubscribe();
});
it("refcounts repeated retention of the same callback object", async () => {
  vi.useFakeTimers();
  let reads = 0;
  const input = { cwd: "/repo", headRef: "main" };
  const poller = createBitbucketPoller(async () => {
    reads++;
    return null;
  });
  const a = poller.retain(input),
    b = poller.retain(input);
  a.unsubscribe();
  a.unsubscribe();
  await vi.advanceTimersByTimeAsync(0);
  expect(reads).toBe(1);
  b.unsubscribe();
  expect(vi.getTimerCount()).toBe(0);
});
