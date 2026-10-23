import { expect, it } from "vitest";
import { BrainConfigSchema, ProfilesStoreSchema, type ProfilesStore } from "../config/schema.js";
import type { Model } from "../types.js";
import type { EngineProcess } from "./engine-process.js";
import type { ManagedModelProcess } from "./process-pool.js";
import { BrainJobs } from "./jobs.js";
import { ModelOperations, type ModelOperationPorts } from "./model-operations.js";
import { ModelProfiles } from "./model-profiles.js";

const model = {
  id: "fixture/model",
  displayName: "Fixture",
  modelPath: "/fixture/model.gguf",
  mmprojPath: null,
} as Model;
const measurement = {
  kvBytesPerToken: 1,
  baseOverheadBytes: 2,
  measuredAt: "2026-10-23T00:00:00Z",
  cacheTypeK: "q8_0",
  cacheTypeV: "q8_0",
  vision: false,
  samples: [],
  theoreticalKvBytesPerToken: null,
  theoreticalRatio: null,
};
function fixture(overrides: Partial<ModelOperationPorts>) {
  let store = ProfilesStoreSchema.parse({});
  const profiles = new ModelProfiles(BrainConfigSchema.parse({}), {
    read: () => structuredClone(store),
    write: (next: ProfilesStore) => {
      store = next;
    },
    runtimeBuild: () => null,
  });
  const lease = {
    supervisor: {
      profile: profiles.read(model).profile,
      host: "127.0.0.1",
      internalPort: 1,
      args: ["--fixture"],
      runtime: { label: "fixture" },
    },
    start: async () => {},
    stop: async () => {},
  } as unknown as ManagedModelProcess<EngineProcess>;
  const jobs = new BrainJobs(() => {});
  const admissions: string[] = [];
  const operations = new ModelOperations(jobs, {
    env: { OTTO_HOME: "/isolated-fixture" },
    profiles,
    gpu: async () => null,
    readUsedBytes: async () => null,
    operation: async (_model, kind, run, signal) => {
      signal.throwIfAborted();
      admissions.push(kind);
      return run(lease);
    },
    ...overrides,
  });
  return { jobs, operations, profiles, admissions, lease };
}

it("calibrates through the supplied lease and commits only a successful measurement", async () => {
  let usedLease: unknown;
  const fixtureValue = fixture({
    calibrate: async (options) => {
      usedLease = options.process;
      options.onProgress?.({ phase: "measured", contextSize: 4096, deltaBytes: 42 });
      return measurement;
    },
  });
  const job = fixtureValue.operations.start(model, "calibrate");
  expect(await fixtureValue.jobs.wait(job.id)).toMatchObject({
    state: "completed",
    result: { kvBytesPerToken: 1 },
  });
  expect(usedLease).toBe(fixtureValue.lease);
  expect(fixtureValue.admissions).toEqual(["calibrate"]);
  expect(fixtureValue.profiles.read(model).profile.calibrationRequired).toBe(false);
  await fixtureValue.jobs.close();
});

it("never commits a failed calibration or exposes its raw progress error", async () => {
  const value = fixture({
    calibrate: async (options) => {
      options.onProgress?.({ phase: "failed", contextSize: 4096, error: "private fixture token" });
      throw new Error("private fixture token");
    },
  });
  const job = value.operations.start(model, "calibrate");
  const completed = await value.jobs.wait(job.id);
  expect(completed!.state).toBe("failed");
  expect(JSON.stringify(completed)).not.toContain("private fixture token");
  expect(value.profiles.read(model).profile.calibrationRequired).toBe(true);
  await value.jobs.close();
});

it("sweeps the requested budgets on the same lease and preserves a concurrent profile edit", async () => {
  const value = fixture({
    sweep: async (options) => {
      expect(options.process).toBe(value.lease);
      expect(options.budgets).toEqual([0, 128, -1]);
      const before = value.profiles.read(model);
      value.profiles.save(model, { reasoningBudget: 700 }, before.revision);
      return {
        recommended: 128,
        sweptAt: "2026-10-23T00:00:00Z",
        ranked: [],
        results: [
          {
            budget: 0,
            error: "private fixture path",
            contentChars: 0,
            filesDelivered: 0,
            contentPerSecond: 0,
          },
          {
            budget: 128,
            error: null,
            contentChars: 2048,
            filesDelivered: 4,
            contentPerSecond: 100,
            tokensPerSecond: 12,
            elapsedSeconds: 20,
          },
        ],
      };
    },
  });
  const job = value.operations.start(model, "sweep", {
    operation: "sweep",
    modelId: model.id,
    budgets: [0, 128, -1],
  });
  const completed = await value.jobs.wait(job.id);
  expect(completed).toMatchObject({
    state: "completed",
    result: {
      recommended: 128,
      applied: false,
      results: [
        { budget: 0, error: "Brain sweep trial failed" },
        { budget: 128, filesDelivered: 4 },
      ],
    },
  });
  expect(JSON.stringify(completed)).not.toContain("private fixture path");
  expect(value.profiles.read(model).profile.reasoningBudget).toBe(700);
  expect(value.admissions).toEqual(["sweep"]);
  await value.jobs.close();
});

it("benchmarks the pool resident endpoint, saves with the owning environment, and releases its lease", async () => {
  let suiteHost: string | undefined;
  let savedEnv: NodeJS.ProcessEnv | undefined;
  let starts = 0;
  let stops = 0;
  let suppliedProfile: unknown = "not started";
  const value = fixture({
    runSuite: async (options) => {
      suiteHost = options!.host;
      expect(options!.port).toBe(1);
      return {
        overall: 1,
        grade: "A",
        results: [],
        seconds: 0,
        executedCode: false,
        pythonVersion: null,
        archiveId: options!.archiveId!,
        ranAt: "2026-10-23T00:00:00Z",
      };
    },
    save: (options, env) => {
      savedEnv = env;
      expect(options.args).toEqual(["--fixture"]);
      return {
        file: "fixture",
        record: { overall: 1, grade: "A", ranAt: "2026-10-23T00:00:00Z" },
      } as ReturnType<NonNullable<ModelOperationPorts["save"]>>;
    },
  });
  value.lease.start = async (profile) => {
    suppliedProfile = profile;
    starts++;
  };
  value.lease.stop = async () => {
    stops++;
  };
  const job = value.operations.start(model, "benchmark");
  expect(await value.jobs.wait(job.id)).toMatchObject({
    state: "completed",
    result: { overall: 1 },
  });
  expect(suiteHost).toBe("127.0.0.1");
  expect(savedEnv).toEqual({ OTTO_HOME: "/isolated-fixture" });
  expect([starts, stops]).toEqual([1, 1]);
  expect(suppliedProfile).toBeUndefined();
  await value.jobs.close();
});
