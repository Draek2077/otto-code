import { expect, it } from "vitest";
import { ProfileSchema } from "../config/schema.js";
import type { GpuInfo, Model } from "../types.js";
import type { OperationSupervisor } from "./process.js";
import { calibrate, kvSpilledToCpu, type CalibrateOptions } from "./calibrate.js";

const GIB = 1024 ** 3;
const gpu: GpuInfo = {
  name: "Fixture GPU",
  driver: "fixture",
  totalBytes: 32 * GIB,
  usedBytes: 0,
  freeBytes: 32 * GIB,
  computeCapability: "fixture",
};
const model: Model = {
  id: "fixture/model",
  displayName: "Fixture model",
  modelPath: "fixture.gguf",
  sizeBytes: GIB,
  mmprojPath: null,
  mmprojBytes: 0,
  quant: "Q4_K_M",
  features: { mtp: false, imatrix: false, distilled: false },
  metadata: {
    arch: "llama",
    contextLength: 262144,
    blockCount: 32,
    headCountKv: 8,
    keyLength: 128,
    valueLength: 128,
  },
};
interface FixtureOptions {
  metal?: boolean;
  closingTable?: boolean;
  spill?: boolean;
  unavailable?: boolean;
  failAt?: number;
  afterStart?(): void;
}
function fixture(overrides: FixtureOptions = {}) {
  const contexts: number[] = [];
  const verbosities: number[] = [];
  let stops = 0;
  let current = 0;
  const supervisor: OperationSupervisor = {
    host: "127.0.0.1",
    internalPort: 1,
    logVerbosity: 1,
    allocationLogLines: [],
    vramAtReadyBytes: null,
    vramBaselineBytes: null,
    loadSeconds: 2,
  };
  const options: CalibrateOptions = {
    model,
    profile: ProfileSchema.parse({ contextSize: 32768 }),
    gpu: overrides.metal ? { ...gpu, driver: "Metal" } : gpu,
    readUsedBytes: async () => (overrides.unavailable ? null : 0),
    releaseDelayMs: 0,
    process: {
      supervisor,
      async start(profile) {
        current = profile.contextSize;
        contexts.push(current);
        verbosities.push(supervisor.logVerbosity);
        supervisor.allocationLogLines = [];
        supervisor.vramBaselineBytes = overrides.unavailable ? null : 0;
        const componentBytes =
          options.model.components?.reduce(
            (sum, component) =>
              options.profile.enabledComponents.includes(component.id)
                ? sum + component.bytes
                : sum,
            0,
          ) ?? 0;
        supervisor.vramAtReadyBytes = overrides.unavailable
          ? null
          : options.model.sizeBytes + componentBytes + 16 * 1024 ** 2 + current * 16384;
        if (overrides.spill) supervisor.allocationLogLines.push("CPU KV buffer size = 1024.00 MiB");
        if (overrides.metal && !overrides.closingTable)
          supervisor.allocationLogLines.push(
            "Metal_Mapped model buffer size = 1024.00 MiB",
            `Metal KV buffer size = ${current / 64} MiB`,
            "Metal compute buffer size = 16.00 MiB",
          );
        overrides.afterStart?.();
        if (current === overrides.failAt) throw new Error("fixture load failed");
      },
      async stop() {
        stops += 1;
        if (overrides.closingTable)
          supervisor.allocationLogLines.push(
            `[llama-server] | - MTL0 (Fixture) | 32000 = 1000 + (${1040 + current / 64} = 1024 + ${current / 64} + 16) + 0 |`,
          );
      },
    },
  };
  return { options, contexts, verbosities, supervisor, stops: () => stops };
}

it("measures the configured context instead of the native multiplier ceiling", async () => {
  const f = fixture();
  f.options.profile.contextMultiplier = 2;
  const result = await calibrate(f.options);
  expect(f.contexts).toEqual([4096, 32768]);
  expect(result.kvBytesPerToken).toBe(16384);
  expect(result.baseOverheadBytes).toBe(16 * 1024 ** 2);
  expect(f.stops()).toBe(2);
});
it("caps a high sample using the prior calibration and the available capacity", async () => {
  const f = fixture();
  f.options.model = { ...model, sizeBytes: 18 * GIB };
  f.options.profile.contextSize = 700000;
  f.options.profile.contextMultiplier = 2;
  f.options.priorCalibration = { kvBytesPerToken: 28.24 * 1024, baseOverheadBytes: 0.1 * GIB };
  const result = await calibrate(f.options);
  expect(result.samples[1].contextSize).toBeLessThan(524288);
  expect(result.samples[1].contextSize).toBeGreaterThan(8192);
});
it("subtracts enabled bundle weights when measuring fixed runtime overhead", async () => {
  const f = fixture();
  f.options.model = {
    ...model,
    components: [
      {
        id: "drafter",
        label: "Drafter",
        description: "Fixture",
        role: "speculative_drafter",
        path: "drafter.gguf",
        bytes: 14 * 1024 ** 2,
        required: false,
        defaultDownload: false,
        defaultLoad: false,
        available: true,
      },
    ],
  };
  f.options.profile.enabledComponents = ["drafter"];
  expect((await calibrate(f.options)).baseOverheadBytes).toBe(16 * 1024 ** 2);
});
it("refuses spilled samples and always releases the operation's process", async () => {
  const f = fixture({ spill: true });
  await expect(calibrate(f.options)).rejects.toThrow("KV cache split to CPU");
  expect(f.contexts).toEqual([4096]);
  expect(f.stops()).toBe(1);
});
it("refuses absent allocation measurements instead of deriving a false budget", async () => {
  const f = fixture({ unavailable: true });
  await expect(calibrate(f.options)).rejects.toThrow("allocation measurements are unavailable");
  expect(f.stops()).toBe(1);
});
it("uses Metal's own allocation lines and restores the serving verbosity", async () => {
  const f = fixture({ metal: true });
  expect((await calibrate(f.options)).kvBytesPerToken).toBe(16384);
  expect(f.verbosities).toEqual([5, 5]);
  expect(f.supervisor.logVerbosity).toBe(1);
});
it("waits for Metal's closing allocation table and stops each sample once", async () => {
  const f = fixture({ metal: true, closingTable: true });
  expect((await calibrate(f.options)).kvBytesPerToken).toBe(16384);
  expect(f.stops()).toBe(2);
});
it("releases failed loads without returning a partial calibration", async () => {
  const f = fixture({ failAt: 32768 });
  await expect(calibrate(f.options)).rejects.toThrow("fixture load failed");
  expect(f.stops()).toBe(2);
});
it("cancels between loading and measurement without starting another sample", async () => {
  const controller = new AbortController();
  const f = fixture({ afterStart: () => controller.abort(new Error("cancelled")) });
  f.options.signal = controller.signal;
  await expect(calibrate(f.options)).rejects.toThrow("cancelled");
  expect(f.contexts).toEqual([4096]);
  expect(f.stops()).toBe(1);
});
it("rejects duplicate, invalid and beyond-native sample plans before loading", async () => {
  for (const samples of [
    [4096, 4096],
    [0, 4096],
    [Number.NaN, 4096],
    [524288, 1048576],
  ]) {
    const f = fixture();
    f.options.samples = samples;
    await expect(calibrate(f.options)).rejects.toThrow();
    expect(f.contexts).toEqual([]);
  }
});
it("recognizes CPU cache spill without misclassifying a host table with zero cache", () => {
  expect(kvSpilledToCpu(["CPU output buffer size = 16 MiB"])).toBe(false);
  expect(kvSpilledToCpu(["| - Host | 806 = 682 + (806 = 682 + 100 + 24) + 0 |"])).toBe(true);
  expect(kvSpilledToCpu(["| - Host | 706 = 682 + (706 = 682 + 0 + 24) + 0 |"])).toBe(false);
});
