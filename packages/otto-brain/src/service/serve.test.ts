import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import http from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { BrainConfigSchema } from "../config/schema.js";
import { resolveBrainPaths } from "../config/paths.js";
import { readPidFile } from "./pid-lock.js";
import { startService, type ServiceHandle, type BrainRuntime } from "./serve.js";

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
  const config = await (await fetch(`${base}/__host/config`, { headers })).json();
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
