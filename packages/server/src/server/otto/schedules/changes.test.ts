import { afterEach, expect, test, vi } from "vitest";
import { ScheduleChanges } from "./changes.js";

const a = { hostId: "host", projectId: "a" };
const b = { hostId: "host", projectId: "b" };
const all = { hostId: "host", projectId: null };
afterEach(() => {
  vi.useRealTimers();
});

test("construction and version reads install no timers or idle work", () => {
  vi.useFakeTimers();
  const changes = new ScheduleChanges("host");
  expect(changes.version(a)).toBe(0);
  expect(changes.version(all)).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  changes.close();
});
test("project writes wake that project and the aggregate while leaving unrelated demand asleep", async () => {
  const changes = new ScheduleChanges("host");
  const pendingA = changes.watch(a, 0);
  const pendingAll = changes.watch(all, 0);
  let bResolved = false;
  const pendingB = changes.watch(b, 0).then((value) => {
    bResolved = true;
    return value;
  });
  changes.publish(a);
  expect(await pendingA).toEqual({ version: 1 });
  expect(await pendingAll).toEqual({ version: 1 });
  expect(bResolved).toBe(false);
  expect(changes.version(b)).toBe(0);
  changes.publish(b);
  expect(await pendingB).toEqual({ version: 2 });
  changes.close();
});
test("a write between page read and watch returns immediately and legacy changes wake project views", async () => {
  const changes = new ScheduleChanges("host");
  const version = changes.version(a);
  changes.publish(a);
  expect(await changes.watch(a, version)).toEqual({ version: 1 });
  const pendingA = changes.watch(a, 1);
  const pendingB = changes.watch(b, 0);
  changes.publish(all);
  expect(await pendingA).toEqual({ version: 2 });
  expect(await pendingB).toEqual({ version: 2 });
  changes.close();
});
test("a bounded demand wait times out without advancing version and releases its timer", async () => {
  vi.useFakeTimers();
  const changes = new ScheduleChanges("host");
  const wait = changes.watch(a, 0);
  await vi.advanceTimersByTimeAsync(25000);
  expect(await wait).toEqual({ version: 0 });
  expect(vi.getTimerCount()).toBe(0);
  changes.close();
});
test("capacity, host identity and shutdown reject explicitly and release all waiters", async () => {
  vi.useFakeTimers();
  const changes = new ScheduleChanges("host");
  await expect(changes.watch({ ...a, hostId: "wrong" }, 0)).rejects.toMatchObject({
    kind: "invalid",
  });
  const waits = Array.from({ length: 32 }, () => changes.watch(a, 0));
  const finished = Promise.allSettled(waits);
  await expect(changes.watch(a, 0)).rejects.toMatchObject({ kind: "busy" });
  changes.close();
  expect((await finished).every((result) => result.status === "rejected")).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  await expect(changes.watch(a, 0)).rejects.toMatchObject({ kind: "unavailable" });
});
test("evicted inactive project versions force a refresh without retaining an unbounded map", async () => {
  const changes = new ScheduleChanges("host");
  changes.publish(a);
  const old = changes.version(a);
  for (let i = 0; i < 257; i++) changes.publish({ hostId: "host", projectId: `project-${i}` });
  expect(await changes.watch(a, old)).toEqual({ version: 0 });
  expect(changes.version(all)).toBe(258);
  changes.close();
});
