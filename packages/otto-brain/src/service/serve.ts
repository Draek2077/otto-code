/** Brain's listener owns transport and lifetime; model engines attach behind it. */
import http from "node:http";
import https from "node:https";
import { timingSafeEqual } from "node:crypto";
import type { BrainConfig } from "../config/schema.js";
import { resolveBrainPaths, type BrainPaths } from "../config/paths.js";
import { acquireServiceOwnership } from "./ownership.js";
import { writePidFile } from "./pid-lock.js";
import { CertManager, resolveTlsOptions } from "./tls.js";
import { ipv4 } from "./tailscale.js";
import { readObject, sendJson, RequestError } from "./http-body.js";

export interface BrainRuntime {
  /** The host never exposes engine internals or configuration in status. */
  status(): { state: string; model: string | null; modelId: string | null };
  /** Optional complete management snapshot; the listener still owns authorization. */
  snapshot?(): Promise<Record<string, unknown>>;
  capabilities?: Readonly<Record<string, boolean | number>>;
  handleRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): boolean | Promise<boolean>;
  /** Engines must cancel work and terminate owned processes on abort. */
  stop(signal: AbortSignal): Promise<void>;
}
export interface StartServiceOptions {
  config: BrainConfig;
  env?: NodeJS.ProcessEnv;
  runtime?: BrainRuntime;
  /** Called only after exclusive home ownership and transport policy validation. */
  createRuntime?(context: BrainRuntimeContext): BrainRuntime | Promise<BrainRuntime>;
}
export interface BrainRuntimeContext {
  instanceId: string;
  paths: BrainPaths;
  env: NodeJS.ProcessEnv;
  config: BrainConfig;
}
export interface ServiceHandle {
  server: http.Server;
  host: string;
  port: number;
  secure: boolean;
  displayHost: string;
  stop(): Promise<void>;
}

function json(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}
function loopback(host: string): boolean {
  return host === "localhost" || host === "::1" || host === "127.0.0.1";
}
export function extractToken(request: http.IncomingMessage): string | null {
  const auth = request.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7).trim();
  const apiKey = request.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey) return apiKey;
  const token = request.headers["x-otto-brain-token"];
  return typeof token === "string" ? token : null;
}
function authorized(request: http.IncomingMessage, token: string | null): boolean {
  if (!token) return true;
  const value = extractToken(request);
  if (value === null) return false;
  const actual = Buffer.from(value);
  const expected = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function redacted(config: BrainConfig): BrainConfig {
  return {
    ...config,
    auth: { ...config.auth, token: config.auth.token ? "********" : null },
    hfToken: config.hfToken ? "********" : null,
  };
}

function handler(
  config: BrainConfig,
  runtime: BrainRuntime | undefined,
  isStopping: () => boolean,
  control: { instanceId: string; stop(): Promise<void> },
): http.RequestListener {
  const token = config.auth.mode === "token" ? config.auth.token : null;
  return (request, response) => {
    // Broken client sockets are request failures, never uncaught host failures.
    response.on("error", () => {});
    const route = request.url?.split("?")[0];
    if (route === "/health" && request.method === "GET") {
      json(response, isStopping() ? 503 : 200, { status: isStopping() ? "stopping" : "ok" });
      return;
    }
    if (!authorized(request, token)) {
      json(response, 401, { error: "unauthorized" });
      return;
    }
    if (isStopping()) {
      json(response, 503, { error: "Brain host is stopping" });
      return;
    }
    void dispatch(request, response, route, config, runtime, control).catch(() => {
      // Driver errors can contain secrets or local paths. Keep them out of
      // public responses; the owning integration records its own diagnostics.
      if (response.headersSent) response.destroy();
      else json(response, 503, { error: "Brain runtime request failed" });
    });
  };
}
async function dispatch(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  route: string | undefined,
  config: BrainConfig,
  runtime: BrainRuntime | undefined,
  control: { instanceId: string; stop(): Promise<void> },
): Promise<void> {
  if (route === "/__host/local/stop" && request.method === "POST") {
    await localStop(request, response, control);
    return;
  }
  if (request.method === "GET") {
    if (route === "/__host/config") {
      json(response, 200, redacted(config));
      return;
    }
    if (route === "/__host/capabilities") {
      json(response, 200, {
        writable: false,
        profiles: false,
        budget: false,
        logs: false,
        delete: false,
        load: false,
        resources: false,
        inventory: false,
        rename: false,
        reset: false,
        events: false,
        liveInference: false,
        logEvents: false,
        jobs: false,
        restart: false,
        processPool: false,
        ...runtime?.capabilities,
      });
      return;
    }
    if (route === "/__host/status") {
      const status = runtime?.snapshot
        ? await runtime.snapshot()
        : (runtime?.status() ?? { state: "stopped", model: null, modelId: null });
      json(response, 200, status);
      return;
    }
    if (!runtime && (route === "/v1/models" || route === "/api/v0/models")) {
      json(response, 200, { object: "list", data: [] });
      return;
    }
  }
  if (runtime && (await runtime.handleRequest(request, response))) return;
  if (route?.startsWith("/v1/") || route === "/v1/messages") {
    json(response, 503, { error: "No Brain model is loaded" });
    return;
  }
  json(response, 404, { error: "not found" });
}

/** Private ownership proof replaces signalling whichever process reused a recorded PID. */
async function localStop(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  control: { instanceId: string; stop(): Promise<void> },
): Promise<void> {
  const address = request.socket.remoteAddress;
  if (
    request.headers.origin ||
    !new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]).has(address ?? "")
  ) {
    sendJson(response, 403, { error: "Local Brain ownership is required" });
    return;
  }
  try {
    const body = await readObject(request, AbortSignal.timeout(3000), 4096);
    if (body.instanceId !== control.instanceId) {
      sendJson(response, 409, { error: "Brain host lifetime changed" });
      return;
    }
    response.once("finish", () => {
      setImmediate(() => {
        void control.stop().catch(() => {
          process.exitCode = 1;
        });
      });
    });
    sendJson(response, 200, { accepted: true, instanceId: control.instanceId });
  } catch (error) {
    sendJson(response, error instanceof RequestError ? error.status : 400, {
      error: "Invalid local Brain stop request",
    });
  }
}

function closeListener(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    // End idle, active and event-stream sockets. The model engine has a separate
    // lifetime and must release its own requests in stop().
    server.closeAllConnections();
  });
}

async function stopRuntime(runtime: BrainRuntime | undefined): Promise<void> {
  if (!runtime) return;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      runtime.stop(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("Brain runtime shutdown exceeded 6 seconds"));
        }, 6000);
        timeout.unref();
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function startService({
  config,
  env = process.env,
  runtime: attachedRuntime,
  createRuntime,
}: StartServiceOptions): Promise<ServiceHandle> {
  if (attachedRuntime && createRuntime) throw new Error("Provide one Brain runtime owner");
  const ownership = acquireServiceOwnership(env);
  let runtime = attachedRuntime;
  let server: http.Server | undefined;
  let certManager: CertManager | undefined;
  let stopping = false;
  let stopped: Promise<void> | undefined;
  const stop = (): Promise<void> =>
    (stopped ??= (async () => {
      stopping = true;
      certManager?.stop();
      try {
        if (server) await closeListener(server);
        await stopRuntime(runtime);
      } finally {
        ownership.release();
      }
    })());
  try {
    const host =
      config.listen.host === "tailscale"
        ? await ipv4(config.tls.tailscaleExe ?? undefined)
        : config.listen.host;
    const token = config.auth.mode === "token" ? config.auth.token : null;
    if (
      !loopback(host) &&
      !token &&
      !config.allowInsecureBind &&
      env.OTTO_BRAIN_ALLOW_INSECURE !== "1"
    )
      throw new Error("refusing to bind Brain without auth");
    const paths = resolveBrainPaths(env);
    const tls = await resolveTlsOptions(config, paths);
    if (createRuntime)
      runtime = await createRuntime({ instanceId: ownership.instanceId, paths, env, config });
    const listener = handler(config, runtime, () => stopping, {
      instanceId: ownership.instanceId,
      stop,
    });
    if (tls) {
      certManager = new CertManager(tls);
      const pair = await certManager.load();
      const secureServer = https.createServer(pair, listener);
      certManager.on("renewed", (next) => secureServer.setSecureContext(next));
      server = secureServer;
    } else server = http.createServer(listener);
    const boundServer = server;
    await new Promise<void>((resolve, reject) => {
      boundServer.once("error", reject);
      boundServer.listen(config.listen.port, host, () => {
        boundServer.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Brain did not bind a TCP listener");
    const port = address.port;
    const displayHost = tls?.hostname ?? host;
    writePidFile(
      {
        pid: process.pid,
        host,
        port,
        startedAt: new Date().toISOString(),
        instanceId: ownership.instanceId,
        secure: Boolean(tls),
        displayHost,
      },
      env,
    );
    certManager?.start();
    return { server, host, port, secure: Boolean(tls), displayHost, stop };
  } catch (error) {
    try {
      await stop();
    } catch (cleanupError) {
      const failure = new AggregateError(
        [error, cleanupError],
        "Brain startup and cleanup failed",
        { cause: error },
      );
      throw failure;
    }
    throw error;
  }
}
