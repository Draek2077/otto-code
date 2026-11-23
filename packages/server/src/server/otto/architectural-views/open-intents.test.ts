import { afterEach, expect, test, vi } from "vitest";
import { ViewOpenIntents } from "./open-intents.js";
const identity = {
  viewId: "system",
  origin: { location: "repository" as const, storeKey: "a".repeat(64) },
};
afterEach(() => vi.useRealTimers());
test("workspace display is scoped, baseline-only and bounded by a live lease", async () => {
  vi.useFakeTimers();
  const feed = new ViewOpenIntents();
  expect(await feed.wait("client", "lease", "workspace", null)).toEqual({
    cursor: "initial",
    identity: null,
  });
  const waiting = feed.wait("client", "lease", "workspace", "initial");
  feed.show("different", identity);
  await vi.advanceTimersByTimeAsync(1);
  let settled = false;
  void waiting.then(() => {
    settled = true;
    return undefined;
  });
  expect(settled).toBe(false);
  feed.show("workspace", identity);
  const result = await waiting;
  expect(result.identity).toEqual(identity);
  expect(result.cursor).not.toBe("initial");
  const heartbeat = feed.wait("client", "lease", "workspace", result.cursor);
  await vi.advanceTimersByTimeAsync(20000);
  expect(await heartbeat).toEqual(result);
  feed.close();
  expect(vi.getTimerCount()).toBe(0);
});
test.each(["release", "disconnect", "close"] as const)(
  "%s wakes and rejects a pending display wait without retained timers",
  async (action) => {
    vi.useFakeTimers();
    const feed = new ViewOpenIntents();
    await feed.wait("client", "lease", "workspace", null);
    const waiting = feed.wait("client", "lease", "workspace", "initial");
    const rejection = expect(waiting).rejects.toThrow("released");
    if (action === "release") feed.release("client", "lease");
    else if (action === "disconnect") feed.releaseClient("client");
    else feed.close();
    await rejection;
    feed.close();
    expect(vi.getTimerCount()).toBe(0);
  },
);
test("one client cannot reuse a lease across workspace scopes or accumulate unbounded demand", async () => {
  vi.useFakeTimers();
  const feed = new ViewOpenIntents();
  await feed.wait("client", "0", "workspace", null);
  await expect(feed.wait("client", "0", "other", null)).rejects.toThrow("another workspace");
  for (let index = 1; index < 8; index++)
    await feed.wait("client", String(index), "workspace", null);
  await expect(feed.wait("client", "9", "workspace", null)).rejects.toThrow("Too many");
  await vi.advanceTimersByTimeAsync(30000);
  expect(vi.getTimerCount()).toBe(0);
  await feed.wait("client", "new", "workspace", null);
  feed.close();
});
