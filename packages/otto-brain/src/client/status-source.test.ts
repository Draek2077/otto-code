import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { z } from "zod/v3";
import { fixtureRoot } from "../../test-fixtures.js";
import { BrainConfigSchema } from "../config/schema.js";
import { HostEngine } from "../service/engine.js";
import { readPidFile } from "../service/pid-lock.js";
import { startService, type ServiceHandle } from "../service/serve.js";
import {
  brainStatusSource,
  localBrainStatusSource,
  type BrainStatusTransport,
} from "./status-source.js";
import { BrainStatusStore } from "./status-store.js";

const StatusSchema = z.object({ instanceId: z.string(), state: z.string() });
type Status = z.infer<typeof StatusSchema>;
const stores: BrainStatusStore<Status>[] = [];
const hosts: ServiceHandle[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const host of hosts.splice(0)) await host.stop();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function transportFixture() {
  let emit: Parameters<BrainStatusTransport["events"]>[0] = () => {};
  const source = brainStatusSource(
    {
      events: async (receive) => {
        emit = receive;
      },
    },
    (input) => StatusSchema.parse(input),
  );
  const statuses: Status[] = [];
  const logs: unknown[] = [];
  return { source, statuses, logs, emit: (event: Parameters<typeof emit>[0]) => emit(event) };
}
const status = {
  instanceId: "fixture-owner",
  state: "ready",
  capabilities: { events: true, logCursors: true },
};

it("validates capability, host identity, log cursors and the owning status DTO", async () => {
  const f = transportFixture();
  await f.source.open(
    { status: (value) => f.statuses.push(value), log: (value) => f.logs.push(value) },
    new AbortController().signal,
  );
  f.emit({ event: "status", data: status });
  f.emit({ event: "log", data: { instanceId: status.instanceId, index: 12, line: "evidence" } });
  expect(f.statuses).toEqual([{ instanceId: status.instanceId, state: "ready" }]);
  expect(f.logs).toEqual([{ instanceId: status.instanceId, index: 12, line: "evidence" }]);
  expect(() =>
    f.emit({ event: "status", data: { ...status, capabilities: { events: true } } }),
  ).toThrow("Update the Brain host");
  expect(() => f.emit({ event: "status", data: { ...status, state: null } })).toThrow();
  expect(() =>
    f.emit({ event: "log", data: { instanceId: status.instanceId, index: -1, line: "invalid" } }),
  ).toThrow();
  expect(() =>
    f.emit({
      event: "log",
      data: { instanceId: status.instanceId, index: Number.MAX_SAFE_INTEGER, line: "invalid" },
    }),
  ).toThrow();
  expect(f.statuses).toHaveLength(1);
  expect(f.logs).toHaveLength(1);
});

it("refuses a DTO projection that changes the host identity", async () => {
  const source = brainStatusSource(
    {
      events: async (receive) => receive({ event: "status", data: status }),
    },
    () => ({ instanceId: "other-owner" }),
  );
  await expect(
    source.open({ status: () => {}, log: () => {} }, new AbortController().signal),
  ).rejects.toThrow("changed the host identity");
});

it("shares real host SSE, replays indexed evidence once and releases the only subscription", async () => {
  const root = mkdtempSync(path.join(fixtureRoot(), "brain-feed-"));
  roots.push(root);
  const env = { OTTO_HOME: root };
  const config = BrainConfigSchema.parse({ listen: { port: 0 } });
  let engine!: HostEngine;
  const host = await startService({
    config,
    env,
    createRuntime: (context) => {
      engine = new HostEngine(context, { scan: () => [], gpu: async () => null });
      return engine;
    },
  });
  hosts.push(host);
  engine.logs.publish("retained before the reader");
  const source = localBrainStatusSource({ config, env, record: readPidFile(env)! }, (input) =>
    StatusSchema.parse(input),
  );
  const store = new BrainStatusStore(source, { streamId: "isolated-http-fixture" });
  stores.push(store);
  const first = store.retain();
  const second = store.retain();
  const timeout = AbortSignal.timeout(3000);
  while (store.getSnapshot().logs.length !== 1)
    await store.wait(store.getSnapshot().cursor, timeout);
  expect(store.getSnapshot()).toMatchObject({
    connection: "connected",
    logs: [{ index: 0, line: "retained before the reader" }],
  });
  expect(engine.events.listenerCount).toBe(1);
  first();
  expect(engine.events.listenerCount).toBe(1);
  second();
  await store.close();
  // Socket close notification crosses the server's event-loop boundary.
  for (let index = 0; index < 100 && engine.events.listenerCount > 0; index++)
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  expect(engine.events.listenerCount).toBe(0);
});
