import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createEngineFixture } from "../../test-engine.js";
import { BrainConfigSchema, ProfilesStoreSchema } from "../config/schema.js";
import { runSuite } from "../bench/index.js";
import { runBenchCommand } from "../commands/bench.js";
import { withBrainCommandHost } from "../commands/target.js";
import { renderResult } from "../output/render.js";
import { HostEngine } from "./engine.js";
import { startService } from "./serve.js";
import { readPidFile } from "./pid-lock.js";
import { localBrainRequest } from "./local-client.js";
import { localJobTransport } from "./job-client.js";
import { followBrainJob } from "./job-client.js";
import { EndpointBenchmarkResultSchema } from "./benchmark-run.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const dispose of cleanup.splice(0).toReversed()) await dispose();
});
async function owner(suite: typeof runSuite) {
  const fixture = await createEngineFixture();
  const env = { OTTO_HOME: fixture.root };
  const config = BrainConfigSchema.parse({ listen: { port: 0 }, allowRemoteConfig: true });
  const launch = vi.fn(async () => {
    throw new Error("An external endpoint must not launch a resident");
  });
  const scan = vi.fn(() => []);
  const gpu = vi.fn(async () => null);
  let engine!: HostEngine;
  const service = await startService({
    config,
    env,
    createRuntime: (context) =>
      (engine = new HostEngine(context, {
        scan,
        gpu,
        createSupervisor: launch,
        runtime: () => null,
        runtimeList: () => [],
        profiles: () => ProfilesStoreSchema.parse({}),
        results: () => [],
        ranking: () => [],
        endpointBenchmark: { runSuite: suite },
      })),
  });
  cleanup.push(async () => {
    await service.stop();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });
  const record = readPidFile(env);
  if (!record) throw new Error("Fixture owner did not acquire its home");
  const local = { record, config, env };
  const port = {
    ...localJobTransport(local),
    request: (route: string, signal: AbortSignal, body?: unknown) =>
      localBrainRequest(local, route, body, signal),
  };
  return { root: fixture.root, engine, env, port, launch, scan, gpu };
}

it("runs the real endpoint suite through the selected HTTP owner with no client home or resident effects", async () => {
  let requests = 0;
  const endpoint = http.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      requests++;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: "fixture" } }] }));
    });
  });
  await new Promise<void>((resolve) => endpoint.listen(0, "127.0.0.1", resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) =>
        endpoint.close((error) => {
          if (error) reject(error);
          else resolve();
        }),
      ),
  );
  const address = endpoint.address();
  if (!address || typeof address === "string") throw new Error("Missing endpoint address");
  const suite = vi.fn(async (options: Parameters<typeof runSuite>[0]) =>
    runSuite({ ...options, python: null }),
  );
  const f = await owner(suite);
  const revisionBefore = await f.engine.snapshot();
  const clientHome = path.join(f.root, "untouched-client");
  vi.stubEnv("OTTO_HOME", clientHome);
  const result = await withBrainCommandHost(f.port, () =>
    runBenchCommand({
      endpoint: `127.0.0.1:${address.port}`,
      only: "tool-calling",
      execute: false,
      concurrency: "2",
    }),
  );
  expect(result.data).toMatchObject([
    {
      modelName: `127.0.0.1:${address.port}`,
      profile: null,
      report: { executedCode: false, results: [{ id: "tool-calling", score: 0, error: null }] },
    },
  ]);
  expect(requests).toBeGreaterThan(0);
  expect(suite).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      env: f.env,
      host: "127.0.0.1",
      port: address.port,
      execute: false,
      concurrency: 2,
    }),
  );
  expect(
    renderResult(result, { format: "yaml", quiet: false, noHeaders: false, noColor: true }),
  ).toContain("modelName:");
  expect(f.engine.jobs.list()).toMatchObject([
    { operation: "benchmark", state: "completed", subject: { modelId: null } },
  ]);
  expect((await f.engine.snapshot()).libraryRevision).toBe(revisionBefore.libraryRevision);
  expect(f.launch).not.toHaveBeenCalled();
  expect(f.scan).not.toHaveBeenCalled();
  expect(f.gpu).not.toHaveBeenCalled();
  expect(fs.existsSync(clientHome)).toBe(false);
});

it("keeps admitted endpoint work independent of the request and cancels through the durable job API", async () => {
  let canceled = false;
  const f = await owner(async (options) => {
    await new Promise<void>((_resolve, reject) =>
      options?.signal?.addEventListener(
        "abort",
        () => {
          canceled = true;
          reject(options.signal?.reason);
        },
        { once: true },
      ),
    );
    throw new Error("Canceled fixture cannot complete");
  });
  const admission = await f.port.request(
    "/__host/jobs/benchmark-endpoint",
    AbortSignal.timeout(3000),
    {
      endpoint: "owner-endpoint.invalid:4321",
      options: { execute: false },
    },
  );
  const job = f.engine.jobs.list()[0];
  expect(admission).toMatchObject({ job: { id: job?.id } });
  if (!job) throw new Error("Missing admitted job");
  expect(f.engine.jobs.get(job.id)?.state).toBe("running");
  await f.port.request("/__host/jobs/cancel", AbortSignal.timeout(3000), { id: job.id });
  expect((await followBrainJob(f.port, job.id, AbortSignal.timeout(3000))).state).toBe("canceled");
  expect(canceled).toBe(true);
  expect(f.launch).not.toHaveBeenCalled();
});

it("rejects malformed endpoint or controls before admitting work", async () => {
  const suite = vi.fn(runSuite);
  const f = await owner(suite);
  for (const body of [
    { endpoint: "http://user:secret@host:12", options: {} },
    { endpoint: "host:12/path", options: {} },
    { endpoint: "host:12", options: { concurrency: 0 } },
    { endpoint: "host:12", options: {}, env: { OTTO_HOME: "untrusted" } },
  ])
    await expect(
      f.port.request("/__host/jobs/benchmark-endpoint", AbortSignal.timeout(3000), body),
    ).rejects.toThrow();
  expect(f.engine.jobs.list()).toEqual([]);
  expect(suite).not.toHaveBeenCalled();
  expect(
    EndpointBenchmarkResultSchema.safeParse({ modelName: "host", report: {}, profile: {} }).success,
  ).toBe(false);
});
