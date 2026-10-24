import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import http from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { BrainConfigSchema } from "../config/schema.js";
import { resolveBrainPaths } from "../config/paths.js";
import { readPidFile } from "./pid-lock.js";
import { startService, type ServiceHandle, type BrainRuntime } from "./serve.js";
import { BrainServiceSession } from "./session.js";

const hosts: ServiceHandle[] = [];
const roots: string[] = [];
function fixture() {
  mkdirSync(fileURLToPath(new URL("../../../../.tmp/", import.meta.url)), { recursive: true });
  const root = mkdtempSync(fileURLToPath(new URL("../../../../.tmp/brain-host-", import.meta.url)));
  roots.push(root);
  return { env: { OTTO_HOME: root }, config: BrainConfigSchema.parse({ listen: { port: 0 } }) };
}
async function start(options: Parameters<typeof startService>[0]) {
  const host = await startService(options);
  hosts.push(host);
  return host;
}
afterEach(async () => {
  vi.useRealTimers();
  for (const host of hosts.splice(0)) await host.stop();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("acknowledges explicit owner restart with a lifetime proof and rejects another admission", async () => {
  const options = fixture();
  options.config.allowRemoteConfig = true;
  let complete!: () => void;
  const requestRestart = vi.fn(
    (_model: string | null) =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const host = await start({ ...options, requestRestart });
  const base = `http://127.0.0.1:${host.port}`;
  const instanceId = readPidFile(options.env)!.instanceId;
  const post = (body: unknown) =>
    fetch(`${base}/__host/restart`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  expect((await post({ instanceId: "other-owner" })).status).toBe(409);
  expect(requestRestart).not.toHaveBeenCalled();
  const response = await post({ instanceId, modelId: "explicit/model" });
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ accepted: true, instanceId });
  await vi.waitFor(() => expect(requestRestart).toHaveBeenCalledExactlyOnceWith("explicit/model"));
  expect((await post({ instanceId })).status).toBe(409);
  complete();
});

it("does not advertise or invoke an absent owner restart implementation", async () => {
  const options = fixture();
  options.config.allowRemoteConfig = true;
  const host = await start(options);
  const base = `http://127.0.0.1:${host.port}`;
  expect(await (await fetch(`${base}/__host/capabilities`)).json()).toMatchObject({
    restart: false,
  });
  expect((await fetch(`${base}/__host/restart`, { method: "POST" })).status).toBe(404);
});

it("checks a pinned lifetime before dispatching a terminal model write", async () => {
  const options = fixture();
  const handleRequest = vi.fn(
    async (_request: http.IncomingMessage, response: http.ServerResponse) => {
      response.end(JSON.stringify({ accepted: true }));
      return true;
    },
  );
  const host = await start({
    ...options,
    runtime: {
      status: () => ({ state: "stopped", model: null, modelId: null }),
      handleRequest,
      stop: async () => {},
    },
  });
  const instanceId = readPidFile(options.env)!.instanceId!;
  const base = `http://127.0.0.1:${host.port}`;
  const post = (expected: string) =>
    fetch(`${base}/__host/model/load?id=shared-model`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-otto-brain-instance": expected },
      body: "{}",
    });
  expect((await post("previous-lifetime")).status).toBe(409);
  expect(handleRequest).not.toHaveBeenCalled();
  expect((await post(instanceId)).status).toBe(200);
  expect(handleRequest).toHaveBeenCalledTimes(1);
});

it.each([
  { writable: false, origin: undefined },
  { writable: true, origin: "https://unrelated.example" },
])("rejects restart outside the owning host's write policy", async ({ writable, origin }) => {
  const options = fixture();
  options.config.allowRemoteConfig = writable;
  const requestRestart = vi.fn(async () => {});
  const host = await start({ ...options, requestRestart });
  const response = await fetch(`http://127.0.0.1:${host.port}/__host/restart`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify({ instanceId: readPidFile(options.env)?.instanceId }),
  });
  expect(response.status).toBe(403);
  expect(requestRestart).not.toHaveBeenCalled();
});

it("replaces an isolated unloaded owner after acknowledgment and reads its staged configuration once", async () => {
  const options = fixture();
  options.config.allowRemoteConfig = true;
  let config = options.config;
  const replacements: ServiceHandle[] = [];
  const readConfig = vi.fn(() => config);
  const session = new BrainServiceSession({
    readConfig,
    start: async (current, requestRestart) => {
      const host = await start({
        ...options,
        config: current,
        requestRestart,
        createRuntime: (context) => ({
          status: () => ({ state: "stopped", model: null, modelId: null }),
          snapshot: async () => ({
            instanceId: context.instanceId,
            state: "stopped",
            residents: [],
          }),
          capabilities: { writable: true },
          handleRequest: () => false,
          stop: async () => {},
        }),
      });
      replacements.push(host);
      return host;
    },
  });
  try {
    await session.start();
    const first = readPidFile(options.env)!;
    config = { ...config, runtime: { ...config.runtime, logVerbosity: 2 } };
    const response = await fetch(`http://127.0.0.1:${first.port}/__host/restart`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instanceId: first.instanceId }),
    });
    expect(await response.json()).toEqual({ accepted: true, instanceId: first.instanceId });
    await vi.waitFor(() => expect(replacements).toHaveLength(2));
    const second = readPidFile(options.env)!;
    expect(second.instanceId).not.toBe(first.instanceId);
    expect(second.pid).toBe(first.pid);
    expect(replacements[0].server.listening).toBe(false);
    expect((await fetch(`http://127.0.0.1:${second.port}/health`)).status).toBe(200);
    expect(readConfig).toHaveBeenCalledTimes(2);
  } finally {
    await session.stop();
  }
});

it("serves management while unloaded and releases its exact listener and ownership", async () => {
  const options = fixture();
  const host = await start(options);
  const base = `http://127.0.0.1:${host.port}`;
  expect((await fetch(`${base}/health`)).status).toBe(200);
  expect(await (await fetch(`${base}/__host/status`)).json()).toEqual({
    state: "stopped",
    model: null,
    modelId: null,
  });
  expect(await (await fetch(`${base}/v1/models`)).json()).toEqual({ object: "list", data: [] });
  expect((await fetch(`${base}/v1/chat/completions`, { method: "POST" })).status).toBe(503);
  expect(readPidFile(options.env)?.port).toBe(host.port);
  await expect(startService(options)).rejects.toThrow("already running");
  await Promise.all([host.stop(), host.stop()]);
  expect(readPidFile(options.env)).toBe(null);
  expect(existsSync(`${resolveBrainPaths(options.env).pidFile}.owner`)).toBe(false);
  expect(host.server.listening).toBe(false);
  await start(options);
});

it("creates an engine only after ownership and exposes its authenticated management contract", async () => {
  const options = fixture();
  options.config.auth = { mode: "token", token: "fixture-owner-token" };
  let creations = 0;
  let stops = 0;
  const createRuntime: NonNullable<Parameters<typeof startService>[0]["createRuntime"]> = (
    context,
  ) => {
    creations++;
    expect(existsSync(`${context.paths.pidFile}.owner`)).toBe(true);
    expect(context.instanceId).toBeTruthy();
    return {
      status: () => ({ state: "stopped", model: null, modelId: null }),
      snapshot: async () => ({
        state: "stopped",
        model: null,
        modelId: null,
        residents: [],
        instanceId: context.instanceId,
      }),
      capabilities: { load: true, processPool: true },
      handleRequest: () => false,
      stop: async () => {
        stops++;
      },
    };
  };
  const host = await start({ ...options, createRuntime });
  await expect(startService({ ...options, createRuntime })).rejects.toThrow("already running");
  expect(creations).toBe(1);
  const base = `http://127.0.0.1:${host.port}`;
  expect((await fetch(`${base}/__host/status`)).status).toBe(401);
  const headers = { Authorization: "Bearer fixture-owner-token" };
  expect(await (await fetch(`${base}/__host/status`, { headers })).json()).toMatchObject({
    residents: [],
    instanceId: expect.any(String),
  });
  expect(await (await fetch(`${base}/__host/capabilities`, { headers })).json()).toMatchObject({
    load: true,
    processPool: true,
    delete: false,
  });
  await host.stop();
  expect(stops).toBe(1);
});

it("does not create an engine for unsafe transport and stops a created engine after bind failure", async () => {
  const options = fixture();
  const createRuntime = vi.fn(
    (): BrainRuntime => ({
      status: () => ({ state: "stopped", model: null, modelId: null }),
      handleRequest: () => false,
      stop: vi.fn(async () => {}),
    }),
  );
  options.config.listen.host = "0.0.0.0";
  await expect(startService({ ...options, createRuntime })).rejects.toThrow("without auth");
  expect(createRuntime).not.toHaveBeenCalled();
  const occupied = await start(fixture());
  options.config.listen.host = "127.0.0.1";
  options.config.listen.port = occupied.port;
  await expect(startService({ ...options, createRuntime })).rejects.toThrow("EADDRINUSE");
  expect(createRuntime).toHaveBeenCalledOnce();
  expect(createRuntime.mock.results[0]!.value.stop).toHaveBeenCalledOnce();
});

it("releases ownership after bind failure so the owner can retry", async () => {
  const occupied = await start(fixture());
  const options = fixture();
  options.config.listen.port = occupied.port;
  await expect(startService(options)).rejects.toThrow("EADDRINUSE");
  expect(readPidFile(options.env)).toBe(null);
  options.config.listen.port = 0;
  await start(options);
});

it("masks credentials and does not advertise unimplemented model operations", async () => {
  const options = fixture();
  options.config.auth = { mode: "token", token: "host-fixture-key" };
  options.config.hfToken = "hf-fixture-key";
  const host = await start(options);
  const base = `http://127.0.0.1:${host.port}`;
  const headers = { Authorization: "Bearer host-fixture-key" };
  expect((await fetch(`${base}/health`)).status).toBe(200);
  expect((await fetch(`${base}/__host/config`)).status).toBe(401);
  const config = BrainConfigSchema.parse(
    await (await fetch(`${base}/__host/config`, { headers })).json(),
  );
  expect(config.auth.token).toBe("********");
  expect(config.hfToken).toBe("********");
  const capabilities = await (await fetch(`${base}/__host/capabilities`, { headers })).json();
  expect(capabilities).toMatchObject({
    profiles: false,
    events: false,
    load: false,
    writable: false,
    processPool: false,
  });
});

it("closes an active unfinished request and stops its attached runtime once", async () => {
  let stops = 0;
  let received!: () => void;
  const ready = new Promise<void>((resolve) => {
    received = resolve;
  });
  const runtime: BrainRuntime = {
    status: () => ({ state: "ready", model: "Fixture", modelId: "fixture" }),
    handleRequest: () => {
      received();
      return true;
    },
    stop: async () => {
      stops++;
    },
  };
  const host = await start({ ...fixture(), runtime });
  const request = http.get(`http://127.0.0.1:${host.port}/v1/fixture`);
  const ended = new Promise<void>((resolve) => {
    request.on("error", () => resolve());
    request.on("close", () => resolve());
  });
  await ready;
  await Promise.all([host.stop(), host.stop()]);
  await ended;
  expect(stops).toBe(1);
});

it("keeps management alive after a runtime request fails without exposing its error", async () => {
  const runtime: BrainRuntime = {
    status: () => ({ state: "failed", model: null, modelId: null }),
    handleRequest: () => {
      throw new Error("private-key-in-driver-error");
    },
    stop: async () => {},
  };
  const host = await start({ ...fixture(), runtime });
  const base = `http://127.0.0.1:${host.port}`;
  expect(await (await fetch(`${base}/v1/chat/completions`)).json()).toEqual({
    error: "Brain runtime request failed",
  });
  expect((await fetch(`${base}/health`)).status).toBe(200);
});

it("cleans up after rejecting an unsafe bind", async () => {
  const options = fixture();
  options.config.listen.host = "0.0.0.0";
  await expect(startService(options)).rejects.toThrow("without auth");
  options.config.listen.host = "127.0.0.1";
  await start(options);
});

it("bounds a stuck engine's shutdown and sends cancellation", async () => {
  let entered!: () => void;
  const stopping = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let aborted = false;
  const runtime: BrainRuntime = {
    status: () => ({ state: "ready", model: "fixture", modelId: "fixture" }),
    handleRequest: () => false,
    stop: (signal) => {
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      entered();
      return new Promise(() => {});
    },
  };
  const options = fixture();
  const host = await startService({ ...options, runtime });
  vi.useFakeTimers();
  const outcome = host.stop().catch((error: Error) => error.message);
  await stopping;
  await vi.advanceTimersByTimeAsync(6000);
  expect(await outcome).toBe("Brain runtime shutdown exceeded 6 seconds");
  expect(aborted).toBe(true);
  expect(readPidFile(options.env)).toBe(null);
  expect(host.server.listening).toBe(false);
});
