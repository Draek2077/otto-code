import { expect, test, vi } from "vitest";
import type { ViewIdentity } from "@getpaseo/plugin/otto/architectural-views";
import { createViewOpenFeed } from "./open-feed";
const identity: ViewIdentity = {
  viewId: "system",
  origin: { location: "repository" as const, storeKey: "a".repeat(64) },
};
test("display demand ignores the initial intent and heartbeat, opens only new intent and ignores released replies", async () => {
  const pending: ((value: { cursor: string; identity: typeof identity | null }) => void)[] = [];
  const opened: (typeof identity)[] = [];
  const released: string[] = [];
  const feed = createViewOpenFeed({
    wait: async () =>
      new Promise((resolve) => {
        pending.push(resolve);
      }),
    release: async (id) => {
      released.push(id);
    },
    open: (value) => {
      opened.push(value);
    },
    makeId: () => "lease",
  });
  const settle = async (cursor: string) => {
    pending.shift()!({ cursor, identity });
    for (let index = 0; index < 5; index++) await Promise.resolve();
  };
  const release = feed.retain();
  expect(pending).toHaveLength(1);
  await settle("old");
  expect(opened).toEqual([]);
  await settle("old");
  expect(opened).toEqual([]);
  await settle("new");
  expect(opened).toEqual([identity]);
  release();
  await settle("after-release");
  expect(opened).toEqual([identity]);
  expect(new Set(released)).toEqual(new Set(["lease"]));
  expect(pending).toEqual([]);
});
test("a disconnected display lease retries only while demanded and establishes a fresh baseline", async () => {
  vi.useFakeTimers();
  let calls = 0;
  const released: string[] = [];
  const feed = createViewOpenFeed({
    wait: async () => {
      calls++;
      throw new Error("disconnected");
    },
    release: async (id) => {
      released.push(id);
    },
    open: () => {
      throw new Error("must not navigate");
    },
    makeId: () => `lease-${calls}`,
  });
  try {
    const release = feed.retain();
    for (let index = 0; index < 5; index++) await Promise.resolve();
    expect(calls).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(3001);
    expect(calls).toBe(1);
    expect(released).toContain("lease-0");
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
