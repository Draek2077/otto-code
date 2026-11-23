import { afterEach, expect, test, vi } from "vitest";
import { z } from "zod";
import type { BrainConnectionRead } from "@getpaseo/protocol/otto/brain";
import { BrainConnectionState } from "./connection-state";
import { BrainRpc } from "./rpc";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
function connection(revision = "connection-A"): BrainConnectionRead {
  return {
    version: 1,
    revision,
    config: {
      enabled: false,
      autoStart: false,
      mode: "local",
      remote: { host: "", port: 1234, secure: false, certFingerprint: null },
    },
    credential: { stored: false, effectiveSource: "none" },
  };
}
function metadata(value = connection()) {
  return {
    ok: true,
    value: {
      connection: value,
      owner: null,
      ownerError: null,
      localRunning: false,
      endpoint: null,
    },
  };
}
const cores: BrainConnectionState[] = [];
afterEach(async () => {
  for (const core of cores.splice(0)) core.close();
  await tick();
  vi.useRealTimers();
});
async function tick() {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}
function fixture() {
  const waits: Array<{ input: unknown; reply: ReturnType<typeof deferred<unknown>> }> = [];
  const invoke = vi.fn(async (method: string, input: unknown): Promise<unknown> => {
    if (method === "brain.bootstrap") return metadata();
    if (method === "brain.status.release") {
      for (const wait of waits)
        wait.reply.resolve({ ok: false, error: { kind: "unavailable", message: "Released" } });
      return { ok: true, value: { released: true } };
    }
    const reply = deferred<unknown>();
    waits.push({ input, reply });
    return reply.promise;
  });
  let number = 0;
  const core = new BrainConnectionState(new BrainRpc(invoke), () => `lease-${++number}`);
  cores.push(core);
  return { core, invoke, waits };
}
test("passive snapshots and subscribers create no RPC or retained demand", async () => {
  const f = fixture();
  const original = f.core.getSnapshot();
  const unsubscribe = f.core.subscribe(() => {});
  await tick();
  expect(f.invoke).not.toHaveBeenCalled();
  expect(f.core.getSnapshot()).toBe(original);
  unsubscribe();
});
test("multiple visible consumers share one wait and final release sends exactly one lease release", async () => {
  const f = fixture();
  const first = f.core.retain();
  const second = f.core.retain();
  await tick();
  expect(f.waits).toHaveLength(1);
  first();
  await tick();
  expect(f.invoke.mock.calls.filter(([method]) => method === "brain.status.release")).toHaveLength(
    0,
  );
  second();
  await tick();
  expect(f.invoke.mock.calls.filter(([method]) => method === "brain.status.release")).toHaveLength(
    1,
  );
});
test("a late reply from a released consumer cannot revive status after reactivation", async () => {
  const f = fixture();
  const invoke = f.invoke.getMockImplementation();
  if (!invoke) throw new Error("Fixture invocation unavailable");
  f.invoke.mockImplementation(async (method, input) =>
    method === "brain.status.release"
      ? { ok: true, value: { released: true } }
      : invoke(method, input),
  );
  const release = f.core.retain();
  await tick();
  release();
  await tick();
  const again = f.core.retain();
  await tick();
  expect(f.waits).toHaveLength(2);
  expect(f.waits[0]!.input).not.toEqual(f.waits[1]!.input);
  f.waits[0]!.reply.resolve({
    ok: true,
    value: {
      controlRevision: "connection-A",
      cursor: "old-cursor",
      connection: "disconnected",
      status: null,
      logs: [{ index: 0, line: "late old log" }],
      firstLogIndex: 0,
      nextLogIndex: 1,
      error: null,
    },
  });
  await tick();
  expect(f.core.getSnapshot().feed).toBeNull();
  again();
  f.waits[1]!.reply.resolve({ ok: false, error: { kind: "unavailable", message: "Released" } });
});
test("an explicit fresh connection read invalidates an older in-flight bootstrap", async () => {
  const f = fixture();
  const old = deferred<unknown>();
  f.invoke.mockImplementation(async (method) =>
    method === "brain.bootstrap" ? old.promise : { ok: true, value: connection("new-revision") },
  );
  const pending = f.core.refresh();
  await f.core.readConnection();
  old.resolve(metadata(connection("old-revision")));
  await pending;
  expect(f.core.getSnapshot().connection?.revision).toBe("new-revision");
  expect(f.core.getSnapshot().loading).toBe(false);
});
test("a rejected explicit read does not leave metadata stuck loading", async () => {
  const f = fixture();
  const old = deferred<unknown>();
  f.invoke.mockImplementation(async (method) =>
    method === "brain.bootstrap"
      ? old.promise
      : { ok: false, error: { kind: "unavailable", message: "Read failed" } },
  );
  const pending = f.core.refresh();
  await expect(f.core.readConnection()).rejects.toThrow("Read failed");
  old.resolve(metadata());
  await pending;
  expect(f.core.getSnapshot().loading).toBe(false);
});
test("a late explicit connection read cannot replace a newer explicit read", async () => {
  const f = fixture();
  const old = deferred<unknown>();
  let reads = 0;
  f.invoke.mockImplementation(async () =>
    ++reads === 1 ? old.promise : { ok: true, value: connection("current") },
  );
  const first = f.core.readConnection().catch((error) => error);
  await f.core.readConnection();
  old.resolve({ ok: true, value: connection("stale") });
  expect(await first).toMatchObject({ kind: "conflict" });
  expect(f.core.getSnapshot().connection?.revision).toBe("current");
});
test("unverified response data is conservative even when the transport reports success", async () => {
  const rpc = new BrainRpc(async () => ({ ok: true, value: { wrong: true } }));
  await expect(rpc.request("read", {}, z.object({ revision: z.string() }))).rejects.toMatchObject({
    kind: "unknown",
  });
});
test("a proven validation rejection retains its classification without guessing from transport errors", async () => {
  const validation = new BrainRpc(async () => ({
    ok: false,
    error: { kind: "validation", message: "Correct the field" },
  }));
  await expect(validation.request("save", {}, z.unknown())).rejects.toMatchObject({
    kind: "validation",
  });
  const unavailable = new BrainRpc(async () => {
    throw new Error("private transport diagnostic");
  });
  await expect(unavailable.request("save", {}, z.unknown())).rejects.toMatchObject({
    kind: "unavailable",
  });
  await expect(unavailable.request("save", {}, z.unknown())).rejects.not.toThrow(
    "private transport diagnostic",
  );
});
