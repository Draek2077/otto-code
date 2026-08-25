import assert from "node:assert/strict";
import { test, vi, beforeEach } from "vitest";

import { kvSpilledToCpu, maxContextForCalibration, calibrate } from "./calibrate.js";
import { query, usedBytes } from "../gpu.js";
import * as vram from "../vram.js";
import type { Model } from "../types.js";
import type { Profile } from "../config/schema.js";

// The same hardware shape the VRAM tests use: a Qwen3.6-27B-class model on a
// 32 GB card.
const QWEN36_27B = {
  arch: "qwen35",
  blockCount: 64,
  headCountKv: 4,
  keyLength: 256,
  valueLength: 256,
  contextLength: 262144,
};

// Weight/projector sizes taken from the live 32 GB card under test: the
// budget there reported 15.9 + 0.9 + KV, which puts 524,288 (the YaRN ×2
// ceiling) past the fit line and 401,408 below it.
const MODEL = {
  id: "qwen36-27b-q4_k_m",
  displayName: "Qwen3.6-27B-Q4_K_M",
  sizeBytes: 15.9 * vram.GIB,
  mmprojBytes: 0.9 * vram.GIB,
  mmprojPath: "C:\\fake\\mmproj.gguf",
  metadata: QWEN36_27B,
} as unknown as Model;

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    contextSize: 225000,
    contextMultiplier: 2,
    cacheTypeK: "q8_0",
    cacheTypeV: "q8_0",
    vision: true,
    ...overrides,
  } as unknown as Profile;
}

const GPU_32GB = { totalBytes: 31.8 * vram.GIB };

// A prior calibration measured at ~28 KB/token: on 32 GB that caps the
// context well below the YaRN ×2 ceiling of 524,288.
const PRIOR = { kvBytesPerToken: 28.24 * 1024, baseOverheadBytes: 0.1 * vram.GIB };

vi.mock("../gpu.js", () => ({
  query: vi.fn(),
  usedBytes: vi.fn(),
}));

// The Supervisor is constructed per sample; the mock is a `new`-able function
// that hands back an instance built by the current mockInstanceFactory. A
// function returning an object satisfies `new`, and avoids a class whose only
// member is a constructor. The `mock` prefix is required: vi.mock factories
// may only reference out-of-scope bindings that carry it.
let mockInstanceFactory: () => object = () => ({});
vi.mock("../service/supervisor.js", () => ({
  DEFAULT_INTERNAL_PORT: 53320,
  Supervisor: function () {
    return mockInstanceFactory();
  },
}));

const mockedQuery = vi.mocked(query);
const mockedUsedBytes = vi.mocked(usedBytes);

/** The ready-state fields a fully-GPU load reports at the prior KV rate. */
function loadAtPriorRate(p: Profile) {
  const kv = PRIOR.kvBytesPerToken * p.contextSize;
  return {
    vramAtReadyBytes: MODEL.sizeBytes + MODEL.mmprojBytes + kv + PRIOR.baseOverheadBytes,
    vramBaselineBytes: 0,
    loadSeconds: 3,
  };
}

function useSupervisor(impl: (p: Profile) => Promise<object> | object) {
  mockInstanceFactory = () => {
    // The real supervisor keeps `logLines` on the instance and `start` returns
    // it; the fake does the same so `kvSpilledToCpu` reads the instance, not
    // the return value.
    const instance: Record<string, unknown> = {
      logLines: [],
      stop: async () => {},
      start: vi.fn(async (_m: unknown, p: Profile) => {
        const result = await impl(p);
        Object.assign(instance, result);
        return instance;
      }),
    };
    return instance;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedUsedBytes.mockResolvedValue(0);
  mockInstanceFactory = () => ({});
});

test("kvSpilledToCpu detects the split-cache banner lines", () => {
  assert.equal(kvSpilledToCpu(["model loaded, ready"]), false);
  assert.equal(
    kvSpilledToCpu([
      "llama_new_context_with_model: KV self size = 4096.00 MiB",
      "CPU buffer size = 1024.00 MiB",
    ]),
    true,
  );
  assert.equal(kvSpilledToCpu(["offloading 12 layers to cpu"]), true);
  assert.equal(kvSpilledToCpu(["KV cache offloaded to CPU"]), true);
});

test("maxContextForCalibration answers from a prior, null when unknown", () => {
  const withPrior = maxContextForCalibration(MODEL, makeProfile(), PRIOR, GPU_32GB.totalBytes);
  assert.ok(withPrior !== null && withPrior < 262144 * 2);

  const noGeometry = { ...MODEL, metadata: null } as unknown as Model;
  assert.equal(
    maxContextForCalibration(noGeometry, makeProfile(), null, GPU_32GB.totalBytes),
    null,
  );
});

test("high sample is the configured context, not the YaRN ceiling", async () => {
  mockedQuery.mockResolvedValue({ ...GPU_32GB });
  useSupervisor((p) => loadAtPriorRate(p));

  const profile = makeProfile({ contextSize: 401408 });
  const measured = await calibrate({
    runtime: {} as never,
    releaseDelayMs: 0,
    model: MODEL,
    profile,
    priorCalibration: PRIOR,
  });

  // The native ×2 ceiling is 524,288 - the old code sampled there. The fix
  // measures at the configured 401,408 instead.
  const high = Math.max(...measured.samples.map((s) => s.contextSize));
  assert.equal(high, 401408);
  assert.equal(measured.samples.length, 2);
});

test("high sample is capped by what fits in VRAM", async () => {
  mockedQuery.mockResolvedValue({ ...GPU_32GB });
  useSupervisor((p) => loadAtPriorRate(p));

  // Configured past the YaRN ceiling: the cap must pull the high sample down
  // to the largest context the 32 GB card holds at the prior bytes/token.
  const profile = makeProfile({ contextSize: 700000 });
  const skips: string[] = [];
  const measured = await calibrate({
    runtime: {} as never,
    releaseDelayMs: 0,
    model: MODEL,
    profile,
    priorCalibration: PRIOR,
    onProgress: (p) => {
      if (p.phase === "skip" && p.reason) skips.push(p.reason);
    },
  });

  const maxFits = vram.maxContextThatFits({
    model: MODEL,
    profile,
    calibration: PRIOR,
    totalVramBytes: GPU_32GB.totalBytes,
  });
  assert.ok(maxFits !== null && maxFits < 262144 * 2, "the prior caps below the YaRN ceiling");
  const high = Math.max(...measured.samples.map((s) => s.contextSize));
  assert.equal(high, maxFits);
  assert.ok(
    skips.some((r) => r.includes("exceeds what fits in VRAM")),
    "the cap was announced as a skip, not silently applied",
  );
});

test("a sample whose KV spilled to CPU fails the calibration", async () => {
  mockedQuery.mockResolvedValue({ ...GPU_32GB });
  useSupervisor((p) => ({
    ...loadAtPriorRate(p),
    logLines: [
      "llama_new_context_with_model: KV self size = 1024.00 MiB",
      "CPU buffer size = 512.00 MiB",
    ],
  }));

  await assert.rejects(
    calibrate({
      runtime: {} as never,
      releaseDelayMs: 0,
      model: MODEL,
      profile: makeProfile({ contextSize: 401408 }),
      priorCalibration: PRIOR,
    }),
    /KV cache split to CPU/,
  );
});

test("every load uses the profile's own settings, not calibration's own", async () => {
  mockedQuery.mockResolvedValue({ ...GPU_32GB });
  const starts: Profile[] = [];
  useSupervisor((p) => {
    starts.push(p);
    return loadAtPriorRate(p);
  });

  const profile = makeProfile({ contextSize: 401408, cacheTypeK: "q8_0", cacheTypeV: "q8_0" });
  await calibrate({
    runtime: {} as never,
    releaseDelayMs: 0,
    model: MODEL,
    profile,
    priorCalibration: PRIOR,
  });

  assert.equal(starts.length, 2);
  for (const p of starts) {
    assert.equal(p.cacheTypeK, "q8_0");
    assert.equal(p.cacheTypeV, "q8_0");
    assert.equal(p.contextMultiplier, 2);
  }
});

test("hosted calibration uses the pool-owned lifecycle for every sample", async () => {
  mockedQuery.mockResolvedValue(null);
  const directStart = vi.fn();
  const directStop = vi.fn();
  const resident = {
    logLines: [],
    start: directStart,
    stop: directStop,
    vramAtReadyBytes: 0,
    vramBaselineBytes: 0,
    loadSeconds: 3,
  };
  const starts: number[] = [];
  const stops = vi.fn();

  await calibrate({
    runtime: {} as never,
    model: MODEL,
    profile: makeProfile({ contextSize: 8192 }),
    samples: [4096, 8192],
    releaseDelayMs: 0,
    supervisor: resident as never,
    lifecycle: {
      start: async (profile) => {
        starts.push(profile.contextSize);
        Object.assign(resident, loadAtPriorRate(profile));
      },
      stop: async () => {
        stops();
      },
    },
  });

  assert.deepEqual(starts, [4096, 8192]);
  assert.equal(stops.mock.calls.length, 2);
  assert.equal(directStart.mock.calls.length, 0);
  assert.equal(directStop.mock.calls.length, 0);
});
