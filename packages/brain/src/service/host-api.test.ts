import { describe, expect, it } from "vitest";

import { buildInventoryRow } from "./host-api.js";
import type { Supervisor } from "./supervisor.js";
import { ProfilesStoreSchema, type ProfilesStore } from "../config/schema.js";
import type { RankedModel } from "../ops/results.js";
import type { GpuInfo, Model } from "../types.js";
import { GIB } from "../vram.js";

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: "vendor/model-Q5_K_M.gguf",
    displayName: "Test Model",
    modelPath: "/models/vendor/model-Q5_K_M.gguf",
    mmprojPath: null,
    mmprojBytes: 0,
    quant: "Q5_K_M",
    sizeBytes: 8 * GIB,
    origin: "managed",
    features: { mtp: false, imatrix: false, distilled: false },
    metadata: {
      arch: "qwen3",
      contextLength: 32768,
      blockCount: 48,
      headCountKv: 8,
      keyLength: 128,
      valueLength: 128,
      reasoning: true,
    },
    ...overrides,
  };
}

/** Only the fields `buildInventoryRow` reads; it never touches the child process. */
function fakeSupervisor(state: string, model: Model | null): Supervisor {
  return { state, model } as unknown as Supervisor;
}

const GPU: GpuInfo = {
  name: "NVIDIA GeForce RTX 4090",
  totalBytes: 24 * GIB,
  usedBytes: 2 * GIB,
  freeBytes: 22 * GIB,
  driver: "560.00",
  computeCapability: "8.9",
};

function build(params: {
  model?: Model;
  store?: ProfilesStore;
  gpu?: GpuInfo | null;
  ranking?: RankedModel[];
  supervisor?: Supervisor;
}) {
  const model = params.model ?? makeModel();
  return buildInventoryRow({
    model,
    store: params.store ?? ProfilesStoreSchema.parse({}),
    defaults: undefined,
    gpu: params.gpu === undefined ? GPU : params.gpu,
    ranking: params.ranking ?? [],
    supervisor: params.supervisor ?? fakeSupervisor("stopped", null),
  });
}

describe("buildInventoryRow", () => {
  it("carries the scan row and the GGUF metadata the Models tab shows", () => {
    const row = build({});
    expect(row.id).toBe("vendor/model-Q5_K_M.gguf");
    expect(row.displayName).toBe("Test Model");
    expect(row.family).toBeNull();
    expect(row.quant).toBe("Q5_K_M");
    expect(row.arch).toBe("qwen3");
    expect(row.blockCount).toBe(48);
    expect(row.headCountKv).toBe(8);
    expect(row.contextLength).toBe(32768);
    expect(row.origin).toBe("managed");
  });

  it("carries the curated family identity to the Models tab", () => {
    expect(build({ model: makeModel({ family: "qwen" }) }).family).toBe("qwen");
  });

  it("reports the capability flags the TUI badges V, M and R", () => {
    const plain = build({});
    expect(plain.hasProjector).toBe(false);
    expect(plain.reasoning).toBe(true);
    expect(plain.mtp).toBe(false);

    const rich = build({
      model: makeModel({
        mmprojPath: "/models/vendor/mmproj.gguf",
        mmprojBytes: 512 * 1024 * 1024,
        features: { mtp: true, imatrix: false, distilled: true },
      }),
    });
    expect(rich.hasProjector).toBe(true);
    expect(rich.mtp).toBe(true);
    expect(rich.distilled).toBe(true);
  });

  it("shows vision capability for a bundle before its projector is downloaded", () => {
    const row = build({
      model: makeModel({
        components: [
          {
            id: "vision-projector",
            label: "Image understanding",
            description: "Reads images.",
            role: "vision_projector",
            path: null,
            bytes: 1024,
            required: false,
            defaultDownload: true,
            defaultLoad: false,
            available: false,
          },
        ],
      }),
    });
    expect(row.hasProjector).toBe(true);
  });

  it("computes a VRAM budget and a max context when a GPU is present", () => {
    const row = build({});
    expect(row.budget).not.toBeNull();
    expect(row.budget?.weightsBytes).toBe(8 * GIB);
    expect(row.budget?.totalBytes).toBeGreaterThan(8 * GIB);
    expect(row.maxContextThatFits).toBeGreaterThan(0);
  });

  it("leaves the budget null with no GPU rather than inventing one", () => {
    const row = build({ gpu: null });
    expect(row.budget).toBeNull();
    expect(row.maxContextThatFits).toBeNull();
  });

  it("joins the benchmark score by id", () => {
    const ranking: RankedModel[] = [
      {
        id: "vendor/model-Q5_K_M.gguf",
        displayName: "Test Model",
        overall: 0.72,
        runs: 3,
        std: 2.1,
        grade: "B",
        rank: 1,
      },
    ];
    expect(build({ ranking }).score?.overall).toBe(0.72);
  });

  it("joins the benchmark score by display name when the id differs", () => {
    const ranking: RankedModel[] = [
      { id: null, displayName: "Test Model", overall: 0.5, runs: 1, std: 0, grade: "C" },
    ];
    expect(build({ ranking }).score?.grade).toBe("C");
  });

  it("leaves the score null for an unbenchmarked model", () => {
    const ranking: RankedModel[] = [
      { id: "other", displayName: "Other", overall: 0.9, runs: 2, std: 1, grade: "A" },
    ];
    expect(build({ ranking }).score).toBeNull();
  });

  it("reports the load state only for the model the supervisor holds", () => {
    const model = makeModel();
    const other = makeModel({ id: "vendor/other.gguf", displayName: "Other" });
    expect(build({ model, supervisor: fakeSupervisor("ready", model) }).state).toBe("loaded");
    expect(build({ model, supervisor: fakeSupervisor("starting", model) }).state).toBe("loading");
    expect(build({ model, supervisor: fakeSupervisor("ready", other) }).state).toBe("not-loaded");
    // A crashed supervisor still names its model; that is not "loaded".
    expect(build({ model, supervisor: fakeSupervisor("failed", model) }).state).toBe("not-loaded");
  });

  it("surfaces the blocking warning for a profile that cannot start", () => {
    const model = makeModel();
    const store = ProfilesStoreSchema.parse({});
    store.profiles[model.id] = {
      modelId: model.id,
      modelPath: model.modelPath,
      mmprojPath: null,
      contextSize: 8192,
      cacheTypeK: "q8_0",
      cacheTypeV: "q8_0",
      flashAttention: false,
      gpuLayers: 999,
      vision: false,
      reasoningBudget: 1536,
      reasoningBudgetMessage: "",
      parallelSlots: 1,
      batchSize: null,
      ubatchSize: null,
      extraArgs: [],
    };
    const row = build({ model, store });
    expect(row.profile.flashAttention).toBe(false);
    expect(row.warnings.some((w) => w.blocksStart)).toBe(true);
  });
});
