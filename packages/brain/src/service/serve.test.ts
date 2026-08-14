import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrainConfigSchema, type BrainConfig } from "../config/schema.js";
import { HOST_API_VERSION } from "./host-api.js";
import {
  canRunAlongsideModelPull,
  componentOnlyArgs,
  effectiveAuthToken,
  startService,
} from "./serve.js";

// The bind guard must throw before any process is spawned; a truthy stub runtime
// is all resolveRuntime needs to provide for that path.
vi.mock("../runtime/index.js", () => ({
  resolveRuntime: () => ({ source: "managed" }),
}));

vi.mock("../models/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../models/index.js")>()),
  scanModels: () => [],
}));

const tmpDirs: string[] = [];
function makeTmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "brain-serve-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("remote Brain model downloads", () => {
  it("allows independent model entries to download together", () => {
    expect(canRunAlongsideModelPull("pull")).toBe(true);
  });

  it("keeps runtime-consuming work serialized with model downloads", () => {
    expect(canRunAlongsideModelPull("runtime-install")).toBe(false);
    expect(canRunAlongsideModelPull("calibrate")).toBe(false);
  });

  it("queues only new companion artifacts behind an entry's current transfer", () => {
    expect(
      componentOnlyArgs(
        [
          "pull",
          "--quant",
          "Q4_K_M",
          "--component",
          "vision-projector",
          "--json",
          "--",
          "catalog-entry",
        ],
        ["drafter"],
      ),
    ).toEqual([
      "pull",
      "--quant",
      "Q4_K_M",
      "--json",
      "--components-only",
      "--component",
      "drafter",
      "--",
      "catalog-entry",
    ]);
  });
});

function configWith(overrides: {
  auth?: Partial<BrainConfig["auth"]>;
  listen?: Partial<BrainConfig["listen"]>;
  allowInsecureBind?: boolean;
}): BrainConfig {
  return BrainConfigSchema.parse(overrides);
}

function getJson(port: number, path: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body) as unknown);
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
  });
}

interface EventStream {
  /**
   * Resolves with the next `status` snapshot the caller has not read yet, or
   * rejects if the stream ends first. Reads from a cursor rather than the live
   * edge: the first snapshot is written before this promise can be asked for.
   */
  next(): Promise<Record<string, unknown>>;
  /** Snapshots already delivered. */
  readonly received: Record<string, unknown>[];
  /** Resolves once the server ends the response. */
  readonly ended: Promise<void>;
  close(): void;
}

/**
 * Subscribe to `/__host/events` the way the daemon does, with just enough SSE
 * parsing to assert on the frames.
 */
function openEventStream(port: number, token?: string): Promise<EventStream> {
  return new Promise((resolve, reject) => {
    const received: Record<string, unknown>[] = [];
    let cursor = 0;
    const waiters: (() => void)[] = [];
    let endStream: () => void = () => {};
    const ended = new Promise<void>((resolveEnded) => {
      endStream = resolveEnded;
    });
    const request = http.get(
      {
        host: "127.0.0.1",
        port,
        path: "/__host/events",
        headers: token ? { "x-otto-brain-token": token } : {},
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`expected 200, got ${res.statusCode}`));
          return;
        }
        let buffer = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buffer += chunk;
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");
            if (!frame.startsWith("event: status")) continue;
            const data = frame.split("\n").find((line) => line.startsWith("data: "));
            if (!data) continue;
            received.push(JSON.parse(data.slice(6)) as Record<string, unknown>);
            for (const take of waiters.splice(0)) {
              if (!take()) waiters.push(take);
            }
          }
        });
        res.on("end", endStream);
        res.on("close", endStream);
        resolve({
          received,
          ended,
          next: () =>
            new Promise((resolveNext, rejectNext) => {
              const take = () => {
                if (cursor >= received.length) return false;
                resolveNext(received[cursor]);
                cursor += 1;
                return true;
              };
              if (take()) return;
              waiters.push(take);
              void ended.then(() => rejectNext(new Error("the stream ended")));
            }),
          close: () => request.destroy(),
        });
      },
    );
    request.on("error", reject);
  });
}

function statusCode(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      })
      .on("error", reject);
  });
}

function listenPort(handle: { server: http.Server }): number {
  const address = handle.server.address();
  if (!address || typeof address === "string") throw new Error("expected a TCP listener");
  return address.port;
}

describe("effectiveAuthToken", () => {
  it("returns the token when mode is token and one is set", () => {
    expect(effectiveAuthToken(configWith({ auth: { mode: "token", token: "s3cret" } }))).toBe(
      "s3cret",
    );
  });

  it("returns null when mode is none, even with a stored token", () => {
    expect(effectiveAuthToken(configWith({ auth: { mode: "none", token: "s3cret" } }))).toBeNull();
  });

  it("returns null when mode is token but the token is null", () => {
    expect(effectiveAuthToken(configWith({ auth: { mode: "token", token: null } }))).toBeNull();
  });

  it("returns null when mode is token but the token is empty", () => {
    expect(effectiveAuthToken(configWith({ auth: { mode: "token", token: "" } }))).toBeNull();
  });
});

describe("startService bind guard", () => {
  // A fresh home per test keeps each service's pid/log files isolated. The model
  // scan is mocked empty above so an installed LM Studio library cannot change
  // this launch-path test.
  const env = (): NodeJS.ProcessEnv => ({ OTTO_HOME: makeTmp() });

  it("refuses a non-loopback bind when mode=token has no token (the auth bypass)", async () => {
    const config = configWith({
      listen: { host: "0.0.0.0", port: 0 },
      auth: { mode: "token", token: null },
    });
    await expect(startService({ config, env: env() })).rejects.toMatchObject({
      code: "INSECURE_BIND",
    });
  });

  it("refuses a non-loopback bind with no auth at all", async () => {
    const config = configWith({ listen: { host: "0.0.0.0", port: 0 } });
    await expect(startService({ config, env: env() })).rejects.toMatchObject({
      code: "INSECURE_BIND",
    });
  });

  it("passes the guard when a real token is set", async () => {
    const config = configWith({
      listen: { host: "0.0.0.0", port: 0 },
      auth: { mode: "token", token: "s3cret" },
    });
    const handle = await startService({ config, env: env() });
    await handle.stop();
  });

  it("starts its management API without an installed model", async () => {
    const config = configWith({ listen: { host: "127.0.0.1", port: 0 } });
    const handle = await startService({ config, env: env() });
    try {
      const address = handle.server.address();
      expect(address).not.toBeNull();
      if (!address || typeof address === "string") throw new Error("expected a TCP listener");

      await expect(getJson(address.port, "/__host/status")).resolves.toMatchObject({
        state: "stopped",
        model: null,
        modelId: null,
      });
      await expect(getJson(address.port, "/__host/models")).resolves.toMatchObject({ models: [] });
    } finally {
      await handle.stop();
    }
  });

  it("does not apply to a loopback bind", async () => {
    const handle = await startService({
      config: configWith({ listen: { host: "127.0.0.1", port: 0 } }),
      env: env(),
    });
    await handle.stop();
  });
});

describe("the status event stream", () => {
  const env = (): NodeJS.ProcessEnv => ({ OTTO_HOME: makeTmp() });

  it("advertises events and an api version on the ordinary status", async () => {
    const handle = await startService({
      config: configWith({ listen: { host: "127.0.0.1", port: 0 } }),
      env: env(),
    });
    try {
      await expect(getJson(listenPort(handle), "/__host/status")).resolves.toMatchObject({
        apiVersion: HOST_API_VERSION,
        capabilities: { events: true, liveInference: true },
      });
    } finally {
      await handle.stop();
    }
  });

  it("writes the current snapshot the moment a subscriber connects", async () => {
    const handle = await startService({
      config: configWith({ listen: { host: "127.0.0.1", port: 0 } }),
      env: env(),
    });
    try {
      const stream = await openEventStream(listenPort(handle));
      const first = await stream.next();
      // Closes the race between the daemon's initial status read and its
      // listener attaching: there is nothing to miss between the two.
      expect(first).toMatchObject({ state: "stopped", capabilities: { events: true } });
      stream.close();
    } finally {
      await handle.stop();
    }
  });

  it("rejects a caller that does not present the brain's token", async () => {
    const handle = await startService({
      config: configWith({
        listen: { host: "127.0.0.1", port: 0 },
        auth: { mode: "token", token: "s3cret" },
      }),
      env: env(),
    });
    try {
      const port = listenPort(handle);
      expect(await statusCode(port, "/__host/events")).toBe(401);
      const stream = await openEventStream(port, "s3cret");
      expect(await stream.next()).toMatchObject({ state: "stopped" });
      stream.close();
    } finally {
      await handle.stop();
    }
  });

  it("publishes a supervisor lifecycle transition, and nothing for an unchanged sample", async () => {
    const handle = await startService({
      config: configWith({ listen: { host: "127.0.0.1", port: 0 } }),
      env: env(),
    });
    try {
      const stream = await openEventStream(listenPort(handle));
      await stream.next();

      // A real transition through the supervisor's own state machine: with no
      // runtime resolved, start() fails the load and lands on `failed`.
      handle.supervisor.runtime = null;
      await handle.supervisor
        .start(null as unknown as never, null as unknown as never)
        .catch(() => undefined);

      const next = await stream.next();
      expect(next).toMatchObject({
        state: "failed",
        lastError: "no llama.cpp runtime available",
      });

      // Nothing moved since, so several sampling intervals must add no frames.
      const delivered = stream.received.length;
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(stream.received.length).toBe(delivered);
      stream.close();
    } finally {
      await handle.stop();
    }
  });

  it("ends its listeners on shutdown rather than holding the host open", async () => {
    const handle = await startService({
      config: configWith({ listen: { host: "127.0.0.1", port: 0 } }),
      env: env(),
    });
    const stream = await openEventStream(listenPort(handle));
    await stream.next();
    // An open SSE response is an open connection, so a stop that did not end it
    // would hang here rather than fail.
    await handle.stop();
    await expect(stream.ended).resolves.toBeUndefined();
  });
});
