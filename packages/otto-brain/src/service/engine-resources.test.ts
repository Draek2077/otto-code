import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { fixtureRoot } from "../../test-fixtures.js";
import { BrainConfigSchema } from "../config/schema.js";
import { HostEngine, type HostEnginePorts } from "./engine.js";
import { startService } from "./serve.js";
import type { BrainHostResources } from "./resource-reader.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).toReversed()) await dispose();
});
const sample: BrainHostResources = {
  cpu: 0.25,
  cpuCount: 8,
  ramUsedBytes: 100,
  ramTotalBytes: 200,
  gpu: null,
};
async function fixture(resourceSample: NonNullable<HostEnginePorts["resourceSample"]>) {
  const root = mkdtempSync(path.join(fixtureRoot(), "brain-resources-"));
  let hardwareCalls = 0;
  let childCreations = 0;
  let engine!: HostEngine;
  const host = await startService({
    env: { OTTO_HOME: root },
    config: BrainConfigSchema.parse({ listen: { port: 0 } }),
    createRuntime: (context) => {
      engine = new HostEngine(context, {
        scan: () => [],
        resourceSample,
        gpu: async () => {
          hardwareCalls++;
          throw new Error("A real hardware probe is forbidden in this fixture");
        },
        createSupervisor: async () => {
          childCreations++;
          throw new Error("A model process is forbidden in this fixture");
        },
      });
      return engine;
    },
  });
  cleanup.push(async () => {
    await host.stop();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    engine,
    host,
    base: `http://127.0.0.1:${host.port}`,
    hardwareCalls: () => hardwareCalls,
    childCreations: () => childCreations,
  };
}

it("advertises resources but never samples hardware for cheap status", async () => {
  let samples = 0;
  const f = await fixture(async () => {
    samples++;
    return sample;
  });
  expect(await (await fetch(`${f.base}/__host/capabilities`)).json()).toMatchObject({
    resources: true,
  });
  expect(await (await fetch(`${f.base}/__host/status`)).json()).toMatchObject({ state: "stopped" });
  await f.engine.snapshot();
  expect(samples).toBe(0);
  expect(await (await fetch(`${f.base}/__host/resources`)).json()).toEqual({
    ...sample,
    telemetry: { requests: 0, ok: 0, failed: 0, reasoningOnly: 0, truncated: 0, warning: null },
  });
  expect(samples).toBe(1);
  expect(f.hardwareCalls()).toBe(0);
  expect(f.childCreations()).toBe(0);
});

it("host shutdown cancels and drains the single owned hardware probe", async () => {
  let began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  let stopped = false;
  const f = await fixture(async (signal) => {
    began();
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
    stopped = true;
    signal.throwIfAborted();
    return sample;
  });
  const pending = fetch(`${f.base}/__host/resources`)
    .then((response) => response.arrayBuffer())
    .catch(() => null);
  await started;
  await f.host.stop();
  await pending;
  expect(stopped).toBe(true);
  expect(f.childCreations()).toBe(0);
});
