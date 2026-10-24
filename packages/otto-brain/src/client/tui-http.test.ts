import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureRoot } from "../../test-fixtures.js";
import { createEngineFixture } from "../../test-engine.js";
import { BrainConfigSchema, ProfilesStoreSchema } from "../config/schema.js";
import { forModel } from "../config/profiles.js";
import { HostEngine } from "../service/engine.js";
import { startService } from "../service/serve.js";
import { readPidFile } from "../service/pid-lock.js";
import { localBrainClient } from "../service/local-client.js";
import { openBrainHttpTui } from "./tui-http.js";
import type { BrainTuiClient } from "../tui/client.js";
import type { BrainTuiSnapshot } from "../tui/host.js";

function untilAborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
    if (signal.aborted) resolve();
  });
}
function hasJob(snapshot: BrainTuiSnapshot, id: string): boolean {
  for (const row of snapshot.jobs) if (row.id === id) return true;
  return false;
}

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const release of cleanup.splice(0).toReversed()) await release();
});
async function fixture(withProcess = false) {
  const synthetic = withProcess ? await createEngineFixture() : null;
  const root = synthetic?.root ?? mkdtempSync(path.join(fixtureRoot(), "brain-terminal-http-"));
  const modelPath = path.join(root, "fixture.gguf");
  writeFileSync(modelPath, "isolated-not-a-real-model");
  const model = {
    id: "opaque:model-identity",
    displayName: "Fixture model",
    modelPath,
    mmprojPath: null,
    mmprojBytes: 0,
    quant: "Q4_K_M",
    sizeBytes: 24,
    features: { mtp: false, imatrix: false, distilled: false },
    metadata: { contextLength: 32768, reasoning: true },
    catalogHfRepo: "owner/real-repo",
  };
  const config = BrainConfigSchema.parse({ listen: { port: 0 }, defaultModel: model.id });
  let profiles = ProfilesStoreSchema.parse({});
  profiles.profiles[model.id] = {
    ...forModel(profiles, model, config.defaults),
    preservedPrivateField: "preserved-only-on-owner",
  };
  let engine!: HostEngine;
  const create = vi.fn(async () => {
    if (!synthetic) throw new Error("No runtime may start in this fixture");
    return synthetic.supervisor;
  });
  const sample = vi.fn(async () => ({
    cpu: 0.25,
    cpuCount: 2,
    ramUsedBytes: 1024,
    ramTotalBytes: 2048,
    gpu: {
      name: "Synthetic GPU",
      totalBytes: 1024 * 1024 * 1024,
      usedBytes: 0,
      freeBytes: 1024 * 1024 * 1024,
      driver: "fixture",
      computeCapability: "fixture",
      utilization: 42,
      temperature: 61,
    },
  }));
  const host = await startService({
    config,
    env: { OTTO_HOME: root },
    createRuntime: (context) => {
      engine = new HostEngine(context, {
        scan: () => [model],
        profiles: () => structuredClone(profiles),
        saveProfiles: (next) => {
          profiles = structuredClone(next);
        },
        gpu: async () => null,
        readUsedBytes: async () => null,
        runtime: () => synthetic?.supervisor.runtime ?? null,
        runtimeList: () => [],
        results: () => [],
        ranking: () => [],
        resourceSample: sample,
        createSupervisor: create,
      });
      return engine;
    },
  });
  const endpoint = `http://127.0.0.1:${host.port}`;
  let viewer: BrainTuiClient | undefined;
  cleanup.push(async () => {
    await viewer?.close();
    await host.stop();
    rmSync(root, { recursive: true, force: true });
  });
  const client = await openBrainHttpTui(
    () =>
      localBrainClient({
        record: readPidFile({ OTTO_HOME: root })!,
        config,
        env: { OTTO_HOME: root },
      }),
    endpoint,
  );
  viewer = client;
  return { client, engine, model, create, sample, profiles: () => profiles, root };
}
describe("terminal to owning HTTP service integration", () => {
  it("opens an unloaded host without a runtime, projects canonical data and writes profiles with CAS", async () => {
    const f = await fixture();
    const initial = f.client.getSnapshot();
    expect(initial.models[0].model).toMatchObject({
      id: f.model.id,
      repo: "owner/real-repo",
      hasProjector: false,
    });
    expect(JSON.stringify(initial)).not.toContain(f.root);
    expect(JSON.stringify(initial)).not.toContain("preserved-only-on-owner");
    expect(f.create).not.toHaveBeenCalled();
    expect(f.sample).toHaveBeenCalledTimes(1);
    expect(initial.system?.gpu).toMatchObject({ utilization: 42, temperature: 61 });
    const saved = await f.client.execute({
      type: "profile.save",
      modelId: f.model.id,
      expectedRevision: initial.models[0].revision,
      patch: { contextSize: 4096 },
    });
    expect(saved.status).toBe("success");
    expect(f.client.getSnapshot().models[0].profile.contextSize).toBe(4096);
    expect(f.profiles().profiles[f.model.id].preservedPrivateField).toBe("preserved-only-on-owner");
    const conflict = await f.client.execute({
      type: "profile.save",
      modelId: f.model.id,
      expectedRevision: initial.models[0].revision,
      patch: { contextSize: 8192 },
    });
    expect(conflict.status).toBe("conflict");
    expect(f.profiles().profiles[f.model.id].contextSize).toBe(4096);
    expect(f.create).not.toHaveBeenCalled();
  });
  it("loads only a synthetic Node engine on explicit action and leaves that resident and a durable job alive when the UI closes", async () => {
    const f = await fixture(true);
    const release = f.client.retainStatus();
    await vi.waitFor(() => expect(f.client.getSnapshot().connection).toBe("connected"));
    expect(f.create).not.toHaveBeenCalled();
    expect(await f.client.execute({ type: "model.load", modelId: f.model.id })).toMatchObject({
      status: "success",
    });
    expect(f.create).toHaveBeenCalledTimes(1);
    const job = f.engine.jobs.start(
      "sweep",
      { modelId: f.model.id, catalogModelId: null, repo: null, quant: null },
      async (context) => {
        context.started();
        await untilAborted(context.signal);
        return null;
      },
    );
    await vi.waitFor(() => expect(hasJob(f.client.getSnapshot(), job.id)).toBe(true));
    release();
    await f.client.close();
    expect(f.engine.pool.supervisorFor(f.model.id)?.state).toBe("ready");
    expect(f.engine.jobs.get(job.id)?.state).toBe("running");
  }, 15000);
});
