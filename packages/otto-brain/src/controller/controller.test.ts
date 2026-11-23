import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { fixtureRoot } from "../../test-fixtures.js";
import { afterEach, expect, test, vi } from "vitest";
import { z } from "zod/v3";
import { BrainConnectionStore } from "./connection-store.js";
import { BrainController, type BrainControllerTransport } from "./controller.js";

const StatusSchema = z.object({ instanceId: z.string(), state: z.string() });
const fixtures: Array<{ root: string; controller: BrainController<z.infer<typeof StatusSchema>> }> =
  [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.controller.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
function fixture() {
  const root = mkdtempSync(path.join(fixtureRoot(), "otto-brain-controller-"));
  const connection = new BrainConnectionStore(path.join(root, "otto-config.json"));
  const feeds: Array<{
    receive: Parameters<BrainControllerTransport["events"]>[0];
    signal: AbortSignal;
  }> = [];
  const transport: BrainControllerTransport = {
    request: vi.fn(async () => ({ acknowledged: true })),
    events: (receive, signal) =>
      new Promise<void>((resolve) => {
        feeds.push({ receive, signal });
        signal.addEventListener("abort", () => resolve(), { once: true });
        if (signal.aborted) resolve();
      }),
  };
  const ports = {
    localClient: vi.fn(() => transport),
    remoteClient: vi.fn(() => transport),
    defaultModel: vi.fn((): string | null => null),
    start: vi.fn(async (_model: string | null, _signal?: AbortSignal) => {}),
    stop: vi.fn(async (_signal?: AbortSignal) => {}),
  };
  const controller = new BrainController(connection, ports, (value) => StatusSchema.parse(value));
  fixtures.push({ root, controller });
  function save(patch: unknown) {
    return controller.saveConnection({
      expectedRevision: controller.readConnection().revision,
      patch,
      credential: { action: "keep" },
    });
  }
  return { controller, ports, connection, feeds, transport, save };
}
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

test("construction and settings reads/saves never start or connect a host", () => {
  const f = fixture();
  f.controller.readConnection();
  f.save({ enabled: true, autoStart: true });
  expect(f.ports.start).not.toHaveBeenCalled();
  expect(f.ports.localClient).not.toHaveBeenCalled();
  expect(f.ports.remoteClient).not.toHaveBeenCalled();
});
test("retained disabled icon demand opens no host connection", async () => {
  const f = fixture();
  const release = f.controller.status.retain();
  await tick();
  expect(f.ports.localClient).not.toHaveBeenCalled();
  release();
});
test("uses one selected local feed for multiple consumers and releases it at zero demand", async () => {
  const f = fixture();
  f.save({ enabled: true });
  const first = f.controller.status.retain();
  const second = f.controller.status.retain();
  await tick();
  expect(f.feeds).toHaveLength(1);
  f.feeds[0]!.receive({
    event: "status",
    data: {
      instanceId: "local-owner",
      state: "stopped",
      capabilities: { events: true, logCursors: true },
    },
  });
  expect(f.controller.status.getSnapshot().status?.instanceId).toBe("local-owner");
  first();
  expect(f.feeds[0]!.signal.aborted).toBe(false);
  second();
  expect(f.feeds[0]!.signal.aborted).toBe(true);
});
test("changing to a remote owner aborts the old feed and clears stale status", async () => {
  const f = fixture();
  f.save({ enabled: true });
  const release = f.controller.status.retain();
  await tick();
  const old = f.feeds[0]!;
  f.save({ mode: "remote", remote: { host: "remote.example", secure: true } });
  expect(old.signal.aborted).toBe(true);
  await tick();
  expect(f.ports.remoteClient).toHaveBeenCalledWith(
    expect.objectContaining({ host: "remote.example", secure: true }),
  );
  old.receive({
    event: "status",
    data: { instanceId: "old", state: "ready", capabilities: { events: true, logCursors: true } },
  });
  expect(f.controller.status.getSnapshot().status).toBeNull();
  release();
});
test("Automatic uses the owning saved default and an explicit model overrides it without changing config", async () => {
  const f = fixture();
  f.save({ enabled: true });
  f.ports.defaultModel.mockReturnValue("owner/default.gguf");
  await f.controller.performLocalAction("start");
  expect(f.ports.start).toHaveBeenLastCalledWith("owner/default.gguf", expect.any(AbortSignal));
  f.ports.defaultModel.mockClear();
  await f.controller.performLocalAction("restart", "owner/override.gguf");
  expect(f.ports.start).toHaveBeenLastCalledWith("owner/override.gguf", expect.any(AbortSignal));
  expect(f.ports.defaultModel).not.toHaveBeenCalled();
});

test("Remote mode refuses local lifecycle actions without invoking either host", async () => {
  const f = fixture();
  f.save({ mode: "remote", remote: { host: "remote.example" } });
  await expect(f.controller.performLocalAction("restart")).rejects.toThrow("owning host");
  expect(f.ports.start).not.toHaveBeenCalled();
  expect(f.ports.stop).not.toHaveBeenCalled();
});
test("serializes explicit lifecycle commands and blocks connection changes until settlement", async () => {
  const f = fixture();
  f.save({ enabled: true });
  let settle!: () => void;
  f.ports.stop.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
  );
  const pending = f.controller.performLocalAction("restart", "model-one");
  await expect(f.controller.performLocalAction("start")).rejects.toThrow("still running");
  expect(() => f.save({ mode: "remote" })).toThrow("current Brain lifecycle");
  expect(f.ports.start).not.toHaveBeenCalled();
  settle();
  await pending;
  expect(f.ports.start).toHaveBeenCalledWith("model-one", expect.any(AbortSignal));
});
test("closing during restart prevents the subsequent start without canceling durable host jobs", async () => {
  const f = fixture();
  f.save({ enabled: true });
  let settle!: () => void;
  f.ports.stop.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
  );
  const outcome = f.controller.performLocalAction("restart").catch((error) => error);
  await f.controller.close();
  settle();
  expect(await outcome).toBeInstanceOf(Error);
  expect(f.ports.start).not.toHaveBeenCalled();
  expect(() => f.controller.readConnection()).toThrow("closed");
});
test("management goes through the selected daemon transport, not a browser connection", async () => {
  const f = fixture();
  f.save({ mode: "remote", remote: { host: "remote.example" } });
  const signal = new AbortController().signal;
  await f.controller.request("/__host/catalog", undefined, signal);
  expect(f.transport.request).toHaveBeenCalledWith(
    "/__host/catalog",
    undefined,
    expect.any(AbortSignal),
  );
  expect(f.ports.localClient).not.toHaveBeenCalled();
});
test("a disabled connection cannot start a hidden host but may explicitly stop its existing owner", async () => {
  const f = fixture();
  await expect(f.controller.performLocalAction("start")).rejects.toThrow("Enable Brain");
  expect(f.ports.start).not.toHaveBeenCalled();
  await f.controller.performLocalAction("stop");
  expect(f.ports.stop).toHaveBeenCalledOnce();
});

test("an explicit Remote restart uses only that owner and serializes connection changes until admission", async () => {
  const f = fixture();
  f.save({ enabled: true, mode: "remote", remote: { host: "actual-owner.example" } });
  let acknowledge!: (value: unknown) => void;
  f.transport.request = vi.fn(async (route) => {
    if (route === "/__host/capabilities") return { restart: true, writable: true };
    if (route === "/__host/status") return { instanceId: "remote-lifetime" };
    return new Promise((resolve) => {
      acknowledge = resolve;
    });
  });
  const restart = f.controller.performLifecycleAction("restart", "host/model");
  await tick();
  expect(() => f.save({ mode: "local" })).toThrow("current Brain lifecycle");
  await expect(f.controller.performLifecycleAction("restart")).rejects.toThrow("still running");
  acknowledge({ accepted: true, instanceId: "remote-lifetime" });
  await restart;
  expect(f.ports.localClient).not.toHaveBeenCalled();
  expect(f.ports.start).not.toHaveBeenCalled();
  expect(f.ports.stop).not.toHaveBeenCalled();
  expect(f.transport.request).toHaveBeenLastCalledWith(
    "/__host/restart",
    { instanceId: "remote-lifetime", modelId: "host/model" },
    expect.any(AbortSignal),
  );
});

test("explicit terminal management startup never loads the saved default model", async () => {
  const f = fixture();
  f.save({ enabled: true, autoStart: true });
  f.ports.defaultModel.mockReturnValue("must-not-load-on-ui-open");
  await f.controller.startManagementOwner();
  expect(f.ports.start).toHaveBeenCalledExactlyOnceWith(null, expect.any(AbortSignal));
  expect(f.ports.defaultModel).not.toHaveBeenCalled();
});

test("terminal operations reject a peer-changed connection before sending a model mutation", async () => {
  const f = fixture();
  f.save({ enabled: true, mode: "remote", remote: { host: "original.example" } });
  const origin = f.controller.readConnection().revision;
  let inspected!: (value: unknown) => void;
  f.transport.request = vi.fn(
    () =>
      new Promise((resolve) => {
        inspected = resolve;
      }),
  );
  const mutation = vi.fn(async (request: (route: string, body?: unknown) => Promise<unknown>) =>
    request("/__host/model/load?id=same-id", {}),
  );
  const pending = f.controller.withOwner(
    { connectionRevision: origin, instanceId: "original-lifetime" },
    mutation,
  );
  f.save({ remote: { host: "replacement.example" } });
  inspected({ instanceId: "original-lifetime" });
  await expect(pending).rejects.toThrow("connection changed");
  expect(mutation).not.toHaveBeenCalled();
  expect(f.transport.request).toHaveBeenCalledTimes(1);
});

test("terminal operations reject another lifetime even when a model ID still matches", async () => {
  const f = fixture();
  f.save({ enabled: true });
  f.transport.request = vi.fn(async () => ({ instanceId: "replacement-lifetime" }));
  const mutation = vi.fn(async () => undefined);
  await expect(
    f.controller.withOwner(
      {
        connectionRevision: f.controller.readConnection().revision,
        instanceId: "original-lifetime",
      },
      mutation,
    ),
  ).rejects.toThrow("owner restarted");
  expect(mutation).not.toHaveBeenCalled();
});
test("closing the controller aborts pending client reads without invoking host shutdown", async () => {
  const f = fixture();
  f.transport.request = async (_route, _body, signal) =>
    new Promise((_resolve, reject) => {
      if (!signal) throw new Error("Fixture requires request lifetime");
      signal.addEventListener("abort", () => reject(new Error("Read canceled")), { once: true });
    });
  const pending = f.controller.request("/__host/models").catch((error) => error);
  await f.controller.close();
  expect(await pending).toMatchObject({ message: "Read canceled" });
  expect(f.ports.stop).not.toHaveBeenCalled();
});
test("switching the configured owner cancels old client reads without stopping either host", async () => {
  const f = fixture();
  f.transport.request = async (_route, _body, signal) =>
    new Promise((_resolve, reject) => {
      if (!signal) throw new Error("Fixture requires request lifetime");
      signal.addEventListener("abort", () => reject(new Error("Old owner released")), {
        once: true,
      });
    });
  const pending = f.controller.request("/__host/models").catch((error) => error);
  f.save({ mode: "remote", remote: { host: "selected.example" } });
  expect(await pending).toMatchObject({ message: "Old owner released" });
  expect(f.ports.stop).not.toHaveBeenCalled();
});
