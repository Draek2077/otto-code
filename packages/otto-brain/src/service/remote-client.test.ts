import http from "node:http";
import net from "node:net";
import { X509Certificate } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { z } from "zod/v3";
import { fixtureRoot } from "../../test-fixtures.js";
import { BrainConfigSchema } from "../config/schema.js";
import { brainStatusSource } from "../client/status-source.js";
import { BrainStatusStore } from "../client/status-store.js";
import { HostEngine } from "./engine.js";
import { BrainHttpResponseError } from "./host-http-client.js";
import { readPidFile } from "./pid-lock.js";
import { remoteBrainClient, type RemoteBrainClientOptions } from "./remote-client.js";
import { startService } from "./serve.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).toReversed()) await dispose();
});
function options(port: number): RemoteBrainClientOptions {
  return { host: "127.0.0.1", port, secure: false, certFingerprint: null, authToken: null };
}
async function fixture() {
  const root = mkdtempSync(path.join(fixtureRoot(), "brain-remote-client-"));
  const env = { OTTO_HOME: root };
  const token = "fixture-only-remote-key";
  let engine!: HostEngine;
  const service = await startService({
    env,
    config: BrainConfigSchema.parse({
      listen: { port: 0 },
      tls: { mode: "self-signed", hostname: "localhost" },
      auth: { mode: "token", token },
    }),
    createRuntime: (context) => {
      engine = new HostEngine(context, { scan: () => [], gpu: async () => null });
      return engine;
    },
  });
  cleanup.push(async () => {
    await service.stop();
    rmSync(root, { recursive: true, force: true });
  });
  const fingerprint = new X509Certificate(readPidFile(env)!.certificate!).fingerprint256;
  let requests = 0;
  service.server.prependListener("request", () => {
    requests++;
  });
  return {
    engine,
    requests: () => requests,
    options: {
      ...options(service.port),
      secure: true,
      authToken: token,
      certFingerprint: fingerprint,
    },
  };
}
async function httpFixture(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  cleanup.push(async () => {
    server.closeAllConnections();
    await promisify(server.close.bind(server))();
  });
  return remoteBrainClient(options(address.port));
}

it.each([
  { host: "https://owner.invalid/path" },
  { host: "owner.invalid/foreign" },
  { port: 0 },
  { authToken: " " },
  { authToken: "a\nb" },
  { secure: true, certFingerprint: "bad-pin" },
  { certFingerprint: "AA".repeat(32) },
])("rejects invalid endpoint or credential intent before any connection: %j", (patch) => {
  expect(() => remoteBrainClient({ ...options(12345), ...patch })).toThrow();
});

it("requires system trust when no pin is configured and sends no HTTP credentials", async () => {
  const f = await fixture();
  const client = remoteBrainClient({ ...f.options, certFingerprint: null });
  await expect(client.request("/health")).rejects.toThrow();
  expect(f.requests()).toBe(0);
});

it("rejects a mismatched pin before releasing a socket to the HTTP credential writer", async () => {
  const f = await fixture();
  const client = remoteBrainClient({ ...f.options, certFingerprint: "00".repeat(32) });
  await expect(client.request("/health")).rejects.toThrow("does not match");
  expect(f.requests()).toBe(0);
});

it("uses the same pinned TLS and token policy for management reads and the shared event feed", async () => {
  const f = await fixture();
  // Normalized colon/case variations describe exactly the same certificate.
  const client = remoteBrainClient({
    ...f.options,
    certFingerprint: f.options.certFingerprint.toLowerCase(),
  });
  expect(await client.request("/health")).toEqual({ status: "ok" });
  expect(await client.request("/__host/status")).toMatchObject({ state: "stopped" });
  f.engine.logs.publish("remote owner evidence");
  const schema = z.object({ instanceId: z.string(), state: z.string() });
  const store = new BrainStatusStore(
    brainStatusSource(client, (input) => schema.parse(input)),
    { streamId: "remote-fixture" },
  );
  cleanup.push(() => store.close());
  const release = store.retain();
  const deadline = AbortSignal.timeout(3000);
  while (store.getSnapshot().logs.length !== 1)
    await store.wait(store.getSnapshot().cursor, deadline);
  expect(store.getSnapshot()).toMatchObject({
    connection: "connected",
    logs: [{ index: 0, line: "remote owner evidence" }],
  });
  expect(f.engine.events.listenerCount).toBe(1);
  release();
});

it("keeps failure payloads separate from safe display text for explicit operation validation", async () => {
  const f = await fixture();
  const client = remoteBrainClient(f.options);
  try {
    await client.request("/__host/settings", { ignored: "fixture-secret-must-not-appear" });
    throw new Error("Expected the host settings validator to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(BrainHttpResponseError);
    if (!(error instanceof BrainHttpResponseError)) throw error;
    expect(error.status).toBe(422);
    expect(error.message).toBe("Brain management request failed (422)");
    expect(error.response).toMatchObject({ error: { kind: "validation" } });
  }
});

it("does not follow redirects or forward a credential to another owner", async () => {
  let targetCalls = 0;
  await httpFixture((_request, response) => {
    targetCalls++;
    response.end("{}");
  });
  const source = await httpFixture((_request, response) => {
    response.writeHead(302, { location: "http://foreign.invalid/steal" });
    response.end(JSON.stringify({ error: "untrusted redirect text" }));
  });
  await expect(source.request("/__host/status")).rejects.toThrow("302");
  expect(targetCalls).toBe(0);
});

it("bounds request, response and SSE frames and rejects non-event-stream responses", async () => {
  const client = await httpFixture((request, response) => {
    if (request.url === "/large") {
      response.end(JSON.stringify("x".repeat(4 * 1024 * 1024)));
      return;
    }
    response.end("{}");
  });
  await expect(client.request("/large", "x".repeat(128 * 1024))).rejects.toThrow(
    "request exceeded",
  );
  await expect(client.request("/large")).rejects.toThrow("response exceeded");
  await expect(client.events(() => {}, AbortSignal.timeout(1000))).rejects.toThrow("unavailable");
  const oversized = await httpFixture((_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(`event: log\ndata: ${JSON.stringify({ line: "x".repeat(256 * 1024) })}\n\n`);
  });
  await expect(oversized.events(() => {}, AbortSignal.timeout(1000))).rejects.toThrow("byte limit");
});

it("cancels a pinned connection before an unresponsive TLS handshake finishes", async () => {
  const sockets = new Set<net.Socket>();
  let accepted!: () => void;
  const connected = new Promise<void>((resolve) => {
    accepted = resolve;
  });
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    accepted();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    for (const socket of sockets) socket.destroy();
    await promisify(server.close.bind(server))();
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  const client = remoteBrainClient({
    ...options(address.port),
    secure: true,
    certFingerprint: "00".repeat(32),
  });
  const controller = new AbortController();
  const pending = client.request("/health", undefined, controller.signal);
  const rejected = expect(pending).rejects.toThrow();
  await connected;
  controller.abort();
  await rejected;
});
