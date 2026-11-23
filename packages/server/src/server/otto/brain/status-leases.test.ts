import { afterEach, expect, test, vi } from "vitest";
import { BrainStatusStore, type BrainStatusSource } from "@getpaseo/brain/host";
import { BrainStatusLeases } from "./status-leases.js";
interface Status {
  instanceId: string;
}
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  vi.useRealTimers();
});
function fixture() {
  const sessions: AbortSignal[] = [];
  const receivers: Parameters<BrainStatusSource<Status>["open"]>[0][] = [];
  const source: BrainStatusSource<Status> = {
    open: (receive, signal) =>
      new Promise((resolve) => {
        sessions.push(signal);
        receivers.push(receive);
        signal.addEventListener("abort", () => resolve(), { once: true });
        if (signal.aborted) resolve();
      }),
  };
  const store = new BrainStatusStore(source, { streamId: "lease-fixture" });
  const leases = new BrainStatusLeases(store);
  cleanup.push(async () => {
    leases.close();
    await store.close();
  });
  return { store, leases, sessions, receivers };
}
async function tick() {
  for (let index = 0; index < 6; index++) await Promise.resolve();
}
test("status consumers get no logs while a log reader receives batched cursor deltas", async () => {
  vi.useFakeTimers();
  const f = fixture();
  await f.leases.wait("session", "status", null, {
    includeLogs: false,
    instanceId: null,
    afterLogIndex: null,
  });
  await tick();
  f.receivers[0]!.status({ instanceId: "owner" });
  f.receivers[0]!.log({ instanceId: "owner", index: 0, line: "first" });
  const status = await f.leases.wait("session", "status", null, {
    includeLogs: false,
    instanceId: null,
    afterLogIndex: null,
  });
  expect(status.logs).toEqual([]);
  const pending = f.leases.wait("session", "logs", null, {
    includeLogs: true,
    instanceId: "owner",
    afterLogIndex: 1,
  });
  await tick();
  f.receivers[0]!.log({ instanceId: "owner", index: 1, line: "second" });
  f.receivers[0]!.log({ instanceId: "owner", index: 2, line: "third" });
  await vi.advanceTimersByTimeAsync(100);
  expect((await pending).logs).toEqual([
    { index: 1, line: "second" },
    { index: 2, line: "third" },
  ]);
  expect(f.sessions).toHaveLength(1);
});

test("two authenticated sessions share one feed and release only their own demand", async () => {
  const f = fixture();
  await f.leases.wait("session-a", "lease", null);
  await f.leases.wait("session-b", "lease", null);
  await tick();
  expect(f.sessions).toHaveLength(1);
  f.leases.releaseClient("session-a");
  expect(f.sessions[0]!.aborted).toBe(false);
  f.leases.releaseClient("session-b");
  expect(f.sessions[0]!.aborted).toBe(true);
});
test("a disconnected session cannot retain a pending wait or cancel a replacement session", async () => {
  const f = fixture();
  const first = await f.leases.wait("old-session", "same-app-lease", null);
  const waiting = f.leases
    .wait("old-session", "same-app-lease", first.cursor)
    .catch((error) => error);
  await f.leases.wait("new-session", "same-app-lease", null);
  f.leases.releaseClient("old-session");
  expect(await waiting).toBeInstanceOf(Error);
  await tick();
  expect(f.sessions[0]!.aborted).toBe(false);
});
test("one lease has only one pending wait, with no duplicate stream", async () => {
  const f = fixture();
  const first = await f.leases.wait("session", "lease", null);
  const waiting = f.leases.wait("session", "lease", first.cursor).catch((error) => error);
  await expect(f.leases.wait("session", "lease", first.cursor)).rejects.toThrow("pending wait");
  f.leases.release("session", "lease");
  expect(await waiting).toBeInstanceOf(Error);
});
test("an abandoned lease expires without relying on a subsequent client request", async () => {
  vi.useFakeTimers();
  const f = fixture();
  await f.leases.wait("session", "lease", null);
  await tick();
  await vi.advanceTimersByTimeAsync(30000);
  expect(f.sessions[0]!.aborted).toBe(true);
});
test("bounds leases per session without opening extra feeds", async () => {
  const f = fixture();
  for (let index = 0; index < 4; index++) await f.leases.wait("session", `lease-${index}`, null);
  await expect(f.leases.wait("session", "fifth", null)).rejects.toThrow("Too many");
  await tick();
  expect(f.sessions).toHaveLength(1);
});
test("rejects a request without a session identity before retaining demand", async () => {
  const f = fixture();
  await expect(f.leases.wait("", "lease", null)).rejects.toThrow("authenticated client");
  await tick();
  expect(f.sessions).toHaveLength(0);
});
