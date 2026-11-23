import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { fixtureRoot } from "../../test-fixtures.js";
import { BrainConfigSchema } from "../config/schema.js";
import { readPidFile } from "./pid-lock.js";
import { startService, type ServiceHandle } from "./serve.js";
import { localBrainRequest, localBrainEvents } from "./local-client.js";
import { HostEngine } from "./engine.js";

const hosts: ServiceHandle[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.stop();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
async function fixture(tls = false, withEngine = false) {
  const root = mkdtempSync(path.join(fixtureRoot(), "brain-local-control-"));
  roots.push(root);
  const env = { OTTO_HOME: root };
  const config = BrainConfigSchema.parse({
    listen: { port: 0 },
    auth: { mode: "token", token: "fixture-only-local-key" },
    ...(tls ? { tls: { mode: "self-signed", hostname: "localhost" } } : {}),
  });
  let engine: HostEngine | undefined;
  const host = await startService({
    config,
    env,
    ...(withEngine
      ? {
          createRuntime: (context) => {
            engine = new HostEngine(context, { scan: () => [], gpu: async () => null });
            return engine;
          },
        }
      : {}),
  });
  hosts.push(host);
  return { host, env, config, record: readPidFile(env)!, engine };
}

it("controls the exact local host lifetime instead of signalling a possibly reused PID", async () => {
  const options = await fixture();
  await expect(
    localBrainRequest(options, "/__host/local/stop", { instanceId: "stale-lifetime" }),
  ).rejects.toThrow("409");
  expect(options.host.server.listening).toBe(true);
  expect(
    await localBrainRequest(options, "/__host/local/stop", {
      instanceId: options.record.instanceId,
    }),
  ).toMatchObject({ accepted: true });
  for (let attempt = 0; attempt < 100 && options.host.server.listening; attempt++)
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  expect(options.host.server.listening).toBe(false);
  expect(readPidFile(options.env)).toBeNull();
});

it("verifies the saved TLS certificate and its hostname instead of disabling TLS validation", async () => {
  const options = await fixture(true);
  expect(await localBrainRequest(options, "/health")).toEqual({ status: "ok" });
  await expect(
    localBrainRequest(
      { ...options, record: { ...options.record, displayHost: "wrong-host.invalid" } },
      "/health",
    ),
  ).rejects.toThrow();
});

it("refuses browser-origin stop attempts even with a current lifetime proof", async () => {
  const options = await fixture();
  const response = await fetch(`http://127.0.0.1:${options.host.port}/__host/local/stop`, {
    method: "POST",
    headers: {
      authorization: "Bearer fixture-only-local-key",
      origin: "https://unrelated.invalid",
      "content-type": "application/json",
    },
    body: JSON.stringify({ instanceId: options.record.instanceId }),
  });
  expect(response.status).toBe(403);
  expect(options.host.server.listening).toBe(true);
});

it("retains exact local stop control after staging a different access key and TLS location", async () => {
  const options = await fixture(true);
  const staged = structuredClone(options.config);
  staged.auth = { mode: "token", token: "new-staged-owner-key" };
  staged.tls = {
    ...staged.tls,
    mode: "files",
    certFile: "/not-the-active-owner/certificate.crt",
    hostname: "future-owner.invalid",
  };
  expect(options.record.certificate).toContain("BEGIN CERTIFICATE");
  expect(options.record.certificate).not.toContain("PRIVATE KEY");
  await expect(
    localBrainRequest({ ...options, config: staged }, "/__host/local/stop", {
      instanceId: "old-lifetime",
    }),
  ).rejects.toThrow("409");
  expect(options.host.server.listening).toBe(true);
  expect(
    await localBrainRequest({ ...options, config: staged }, "/__host/local/stop", {
      instanceId: options.record.instanceId,
    }),
  ).toMatchObject({ accepted: true });
  await options.host.stop();
  expect(readPidFile(options.env)).toBeNull();
});

it("consumes the owning host event feed and releases demand on client cancellation", async () => {
  const options = await fixture(false, true);
  const controller = new AbortController();
  let arrived!: () => void;
  const first = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const lifetime = AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]);
  const streaming = localBrainEvents(
    options,
    (event) => {
      if (event.event === "status") {
        expect(event.data.instanceId).toBe(options.record.instanceId);
        arrived();
      }
    },
    lifetime,
  ).catch(() => undefined);
  try {
    await Promise.race([
      first,
      streaming.then(() => {
        throw new Error("No Brain status received");
      }),
    ]);
    expect(options.engine!.events.listenerCount).toBe(1);
  } finally {
    controller.abort();
    await streaming;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  expect(options.engine!.events.listenerCount).toBe(0);
});
